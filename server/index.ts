import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startImageProcessor } from "./image-processor";
import { startBackgroundPricing } from "./background-pricing";
import { warmPool } from "./db";
import path from "path";
import fs from "fs";

const app = express();

// CRITICAL: Stripe webhook needs raw body for signature verification
// This MUST come BEFORE express.json() middleware
// Support both URL patterns: /api/stripe-webhook and /api/stripe/webhook
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve uploaded images statically with long-term caching
const staticOpts = { maxAge: '1y', immutable: true };
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), staticOpts));
app.use('/badge_images', express.static(path.join(process.cwd(), 'badge_images'), staticOpts));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await warmPool();

  // Idempotent startup migration: trusted uploader flag (bypasses image approval queue).
  // Safe to run on every boot in dev and prod; drizzle db:push is blocked by legacy data.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_uploader boolean NOT NULL DEFAULT false`);
  } catch (error) {
    console.error('Startup migration (trusted_uploader) failed:', error);
  }

  // Idempotent startup migration: Drive → Cloudinary import history table.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`CREATE TABLE IF NOT EXISTS drive_image_imports (
      id serial PRIMARY KEY,
      drive_file_id text NOT NULL,
      drive_file_name text NOT NULL,
      drive_modified_time text,
      drive_folder_path text NOT NULL,
      card_id integer NOT NULL,
      image_type text NOT NULL,
      cloudinary_public_id text,
      cloudinary_url text,
      import_batch_id text NOT NULL,
      status text NOT NULL,
      error text,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_drive_image_imports_file_id ON drive_image_imports (drive_file_id)`);
  } catch (error) {
    console.error('Startup migration (drive_image_imports) failed:', error);
  }

  const server = await registerRoutes(app);

  // Start background services
  console.log('Starting background services...');
  // Image processor disabled to prevent automatic mass processing
  // Only run when explicitly needed via admin interface
  // startImageProcessor();
  // Background pricing disabled to conserve eBay API calls
  // Only run when explicitly needed via admin interface
  // startBackgroundPricing();
  console.log('Background services started successfully (image and pricing services disabled)');

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error('Server error:', err);
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Use Railway's dynamic port in production, fallback to 5000 for development
  const port = process.env.PORT || 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // Start the background image processor
    startImageProcessor();
    
    // Nightly pricing backfill: prices cards that have an image but no
    // pricing data yet — up to 1,000/night at 3 AM CT (see ebay-pricing.ts).
    import('./ebay-pricing').then(({ startNightlyPricingBackfillCron }) => {
      startNightlyPricingBackfillCron();
    }).catch((error) => {
      console.error('Failed to start nightly pricing backfill cron:', error);
    });

    // Nightly COMC → Cloudinary image migration: copies hotlinked COMC images
    // into our own Cloudinary account — up to 450/night at 1:30 AM CT
    // (see services/imageMigration.ts).
    import('./services/imageMigration').then(({ startImageMigrationCron }) => {
      startImageMigrationCron();
    }).catch((error) => {
      console.error('Failed to start image migration cron:', error);
    });

    // TEMP (dev-only): run Drive Image Sync dry-run at boot when the flag file
    // exists. Read-only scan; report written to /tmp. Remove after v1 review.
    if (process.env.NODE_ENV === 'development') {
      try {
        if (fs.existsSync('/tmp/run_drive_dryrun')) {
          fs.unlinkSync('/tmp/run_drive_dryrun');
          import('./services/driveImageSync').then(async ({ runDriveImageSyncDryRun }) => {
            const report = await runDriveImageSyncDryRun();
            fs.writeFileSync('/tmp/drive_dryrun_report.json', JSON.stringify(report, null, 2));
            console.log('[DriveSync] Dry-run report written to /tmp/drive_dryrun_report.json');
          }).catch((error) => {
            console.error('[DriveSync] Dev boot dry-run failed:', error);
          });
        }
        if (fs.existsSync('/tmp/run_drive_cleanup')) {
          fs.unlinkSync('/tmp/run_drive_cleanup');
          import('./services/driveImageSync').then(async ({ buildDriveCleanupReport }) => {
            const cleanup = await buildDriveCleanupReport();
            fs.writeFileSync('/tmp/drive_cleanup_report.json', JSON.stringify(cleanup, null, 2));
            console.log('[DriveSync] Cleanup report written to /tmp/drive_cleanup_report.json');
          }).catch((error) => {
            console.error('[DriveSync] Dev boot cleanup report failed:', error);
          });
        }
        if (fs.existsSync('/tmp/run_drive_import_test')) {
          fs.unlinkSync('/tmp/run_drive_import_test');
          import('./services/driveImageSync').then(async ({ runDriveImageImport }) => {
            const report = await runDriveImageImport({ maxFolders: 5, overwrite: false });
            fs.writeFileSync('/tmp/drive_import_test_report.json', JSON.stringify(report, null, 2));
            console.log('[DriveImport] Test import report written to /tmp/drive_import_test_report.json');
          }).catch((error) => {
            console.error('[DriveImport] Dev boot test import failed:', error);
          });
        }
      } catch (e) {
        console.error('[DriveSync] Dev boot trigger check failed:', e);
      }
    }
    

  });
  
  // Handle uncaught exceptions and unhandled rejections to prevent crashes
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    console.log('Application will continue running...');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('Application will continue running...');
  });
})().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

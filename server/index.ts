import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startImageProcessor } from "./image-processor";
import { startBackgroundPricing } from "./background-pricing";
import path from "path";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
  // Serve static files from uploads directory
  app.use('/uploads', express.static('uploads'));
  
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
  const port = parseInt(process.env.PORT || "5000");
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
    
    // Start the background image processor
    startImageProcessor();
    
    // Start background pricing auto-fetch service
    // Temporarily disabled to respect eBay API rate limits
    // import('./ebay-pricing').then(({ startBackgroundPricingFetch }) => {
    //   startBackgroundPricingFetch();
    // });
  });
})();

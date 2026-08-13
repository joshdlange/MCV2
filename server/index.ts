import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
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

// Compress API/JSON and other compressible responses (skips images automatically)
app.use(compression());

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
      // Serializing full response bodies is CPU overhead; skip in production
      if (capturedJsonResponse && process.env.NODE_ENV !== "production") {
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

  // Idempotent startup migration: Collector Profile Customization v1 columns.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_avatar_key text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_focus text`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_followers boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_activity_in_feed boolean NOT NULL DEFAULT true`);
    // Feed is opt-OUT: activity is visible by default unless the user unticks it.
    await db.execute(sql`ALTER TABLE users ALTER COLUMN show_activity_in_feed SET DEFAULT true`);
    // One-time flip of existing users to opted-in (guarded so later opt-outs are respected).
    await db.execute(sql`CREATE TABLE IF NOT EXISTS startup_migrations (name text PRIMARY KEY, run_at timestamp NOT NULL DEFAULT now())`);
    // Marker + flip commit atomically: if the UPDATE fails, the marker rolls
    // back too, so a later startup retries instead of silently skipping.
    await db.transaction(async (tx) => {
      const flip = await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES ('feed_activity_opt_out_default') ON CONFLICT (name) DO NOTHING RETURNING name`);
      if ((flip as any).rows?.length > 0) {
        await tx.execute(sql`UPDATE users SET show_activity_in_feed = true WHERE show_activity_in_feed = false`);
        console.log('Startup migration: flipped existing users to feed opt-in default');
      }
    });
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_customization_completed_at timestamp`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_customization_dismissed_at timestamp`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_customization_skips integer NOT NULL DEFAULT 0`);

    // Feed v1 tables + feed_reaction XP dedupe
    await db.execute(sql`CREATE TABLE IF NOT EXISTS feed_events (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      event_type text NOT NULL,
      title text NOT NULL,
      metadata text,
      related_type text,
      related_id integer,
      visibility text NOT NULL DEFAULT 'public',
      hidden boolean NOT NULL DEFAULT false,
      dedupe_key text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS feed_events_created_idx ON feed_events (created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS feed_events_user_idx ON feed_events (user_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS feed_events_dedupe_idx ON feed_events (dedupe_key)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS feed_reactions (
      id serial PRIMARY KEY,
      feed_event_id integer NOT NULL,
      user_id integer NOT NULL,
      reaction_type text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS feed_reactions_event_user_idx ON feed_reactions (feed_event_id, user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS feed_reactions_event_idx ON feed_reactions (feed_event_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS feed_reactions_user_idx ON feed_reactions (user_id)`);
    await db.execute(sql`ALTER TABLE xp_events ADD COLUMN IF NOT EXISTS feed_event_id integer`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS xp_events_feed_reaction_idx ON xp_events (user_id, feed_event_id) WHERE event_type = 'feed_reaction'`);
    // Follow system v1 — one-way follows; mutual = Friends. No FKs dropped, additive only.
    await db.execute(sql`CREATE TABLE IF NOT EXISTS follows (
      id serial PRIMARY KEY,
      follower_user_id integer NOT NULL REFERENCES users(id),
      following_user_id integer NOT NULL REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT follows_no_self CHECK (follower_user_id <> following_user_id)
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS follows_unique_idx ON follows (follower_user_id, following_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS follows_created_at_idx ON follows (created_at)`);
  } catch (error) {
    console.error('Startup migration (collector profile columns) failed:', error);
  }

  // Idempotent startup seed: Joshua's exclusive reserved avatar (matched by
  // email so it works in dev and prod; only sets it if he hasn't picked one).
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`UPDATE users SET collector_avatar_key = 'reserved-sabretooth'
      WHERE lower(trim(email)) = 'joshdlange045@gmail.com' AND collector_avatar_key IS NULL`);
  } catch (error) {
    console.error('Startup seed (reserved-sabretooth avatar) failed:', error);
  }

  // Idempotent startup migration: users.upgraded_at + trigger that stamps the
  // first transition to a paid plan (covers Stripe, Apple/RevenueCat, and admin
  // paths without touching every route). One-time Stripe backfill for
  // pre-existing subscribers, gated by a startup_migrations marker.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS upgraded_at timestamp`);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION set_upgraded_at() RETURNS trigger AS $$
      BEGIN
        -- Covers both INSERT (e.g. admin-created paid accounts) and UPDATE
        -- transitions to a paid plan. Never overwrites an existing/supplied value.
        IF NEW.plan = 'SUPER_HERO' AND NEW.upgraded_at IS NULL
           AND (TG_OP = 'INSERT' OR OLD.plan IS DISTINCT FROM 'SUPER_HERO') THEN
          NEW.upgraded_at := now();
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.execute(sql`DROP TRIGGER IF EXISTS users_set_upgraded_at ON users`);
    await db.execute(sql`CREATE TRIGGER users_set_upgraded_at BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_upgraded_at()`);
    const marker = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = 'upgraded_at_backfill_v1'`);
    if ((marker as any).rows?.length === 0) {
      const { backfillUpgradedAtFromStripe } = await import('./services/upgradedAtBackfill');
      const result = await backfillUpgradedAtFromStripe();
      if (result.errors === 0) {
        // Only mark done on a clean pass — a transient Stripe failure must not
        // permanently exclude those users; next boot retries (idempotent:
        // only rows still NULL are touched).
        await db.execute(sql`INSERT INTO startup_migrations (name) VALUES ('upgraded_at_backfill_v1') ON CONFLICT (name) DO NOTHING`);
      }
      console.log('[UpgradedAt Backfill] Complete:', JSON.stringify(result), result.errors > 0 ? '(will retry failed users next boot)' : '');
    }
  } catch (error) {
    console.error('Startup migration (upgraded_at) failed:', error);
  }

  // Idempotent startup seed: correct Hall of Fame badge description to match
  // its actual award condition (top 10 by card count, not XP leaderboard).
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      UPDATE badges
      SET description = 'One of the 10 largest card collections in the Vault. A monument to dedication.',
          requirement = '{"type":"top_10_collection_count"}'::jsonb
      WHERE name = 'Hall of Fame'
        AND description = 'Unlocked when you reach the top 10 on the global leaderboard'
    `);
  } catch (error) {
    console.error('Startup seed (Hall of Fame description fix) failed:', error);
  }

  // One-time retroactive sweep: award Hall of Fame to users currently in the
  // top 10 by card count who never triggered a badge check after the
  // description fix (checkHallOfFame only fires on card adds). Quiet SQL
  // insert — no notification blast — gated by a startup_migrations marker
  // and advisory-locked so concurrent boots can't double-run it.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('hall_of_fame_retro_award_v1'))`);
      const m = await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES ('hall_of_fame_retro_award_v1') ON CONFLICT (name) DO NOTHING RETURNING name`);
      if ((m as any).rows?.length > 0) {
        const ins = await tx.execute(sql`
          INSERT INTO user_badges (user_id, badge_id)
          SELECT t.user_id, b.id
          FROM (
            SELECT user_id
            FROM user_collections
            GROUP BY user_id
            ORDER BY COUNT(*) DESC, user_id ASC
            LIMIT 10
          ) t
          CROSS JOIN (SELECT id FROM badges WHERE name = 'Hall of Fame') b
          ON CONFLICT (user_id, badge_id) DO NOTHING`);
        console.log(`[Hall of Fame Retro] Awarded Hall of Fame to ${(ins as any).rowCount ?? 0} existing top-10 collectors`);
      }
    });
  } catch (error) {
    console.error('Startup seed (Hall of Fame retro award) failed:', error);
  }

  // Idempotent startup seed: Contributor badge (3+ approved image uploads).
  // The award code shipped referencing a badge that was never created, so
  // approvals logged errors and nobody ever earned it. Seeds the badge by
  // name, then retro-awards existing qualifying uploaders (quiet SQL insert —
  // no notification blast for months-old contributions).
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      INSERT INTO badges (name, description, category, requirement, rarity, points, unlock_hint, is_active)
      SELECT 'Contributor', 'Community builder! Contributed 3+ approved card images to the Vault.',
        'Achievement', '{"type":"approved_images","count":3}', 'silver', 25,
        'Upload card images and get 3 of them approved', true
      WHERE NOT EXISTS (SELECT 1 FROM badges WHERE name = 'Contributor')`);
    await db.execute(sql`
      INSERT INTO user_badges (user_id, badge_id)
      SELECT p.user_id, b.id
      FROM (SELECT user_id FROM pending_card_images WHERE status = 'approved' GROUP BY user_id HAVING COUNT(*) >= 3) p
      CROSS JOIN (SELECT id FROM badges WHERE name = 'Contributor') b
      ON CONFLICT (user_id, badge_id) DO NOTHING`);
    // Badge shipped without artwork (feed showed the generic ribbon fallback);
    // idempotent icon attach so dev AND prod pick it up.
    await db.execute(sql`UPDATE badges SET icon_url = '/badge_images/contributor.png' WHERE name = 'Contributor' AND (icon_url IS NULL OR icon_url = '')`);
    // One-time feed cleanup: the retro bulk award stamped earned_at = now(),
    // so the feed backfill emitted one "earned the Contributor badge" story
    // per retro recipient — a wall of identical posts. Remove them (and any
    // reactions on them); genuinely NEW Contributor earns emit fresh events.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('contributor_feed_spam_cleanup_v1'))`);
      const m = await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES ('contributor_feed_spam_cleanup_v1') ON CONFLICT (name) DO NOTHING RETURNING name`);
      if ((m as any).rows?.length > 0) {
        await tx.execute(sql`
          DELETE FROM feed_reactions fr USING feed_events fe, badges b
          WHERE fr.feed_event_id = fe.id AND fe.event_type = 'badge_earned'
            AND fe.related_id = b.id AND b.name = 'Contributor'`);
        const del = await tx.execute(sql`
          DELETE FROM feed_events fe USING badges b
          WHERE fe.event_type = 'badge_earned' AND fe.related_id = b.id AND b.name = 'Contributor'`);
        console.log(`[Contributor Feed Cleanup] Removed ${(del as any).rowCount ?? 0} bulk retro-award feed posts`);
      }
    });
    // One-time feed cleanup: "reached 100 cards" milestone posts duplicated
    // the Hundred Club badge post at the same moment. The 100 milestone is
    // removed from COLLECTION_MILESTONES going forward; delete the old posts.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('hundred_club_milestone_dupe_cleanup_v1'))`);
      const m = await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES ('hundred_club_milestone_dupe_cleanup_v1') ON CONFLICT (name) DO NOTHING RETURNING name`);
      if ((m as any).rows?.length > 0) {
        await tx.execute(sql`
          DELETE FROM feed_reactions fr USING feed_events fe
          WHERE fr.feed_event_id = fe.id AND fe.event_type = 'collection_milestone'
            AND fe.dedupe_key LIKE 'collection_milestone:%:100'`);
        const del = await tx.execute(sql`
          DELETE FROM feed_events
          WHERE event_type = 'collection_milestone' AND dedupe_key LIKE 'collection_milestone:%:100'`);
        console.log(`[Hundred Club Dupe Cleanup] Removed ${(del as any).rowCount ?? 0} duplicate 100-card milestone posts`);
      }
    });
  } catch (error) {
    console.error('Startup seed (Contributor badge) failed:', error);
  }

  // One-time migration: convert legacy accepted friendships into mutual
  // follows so the unified Followers/Following/Friends counts reflect them
  // (the old Add Friend system wrote to a separate table the profile header
  // never counted). Idempotent via marker + ON CONFLICT; no notifications.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.transaction(async (tx) => {
      const m = await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES ('friends_follows_merge_v2') ON CONFLICT (name) DO NOTHING RETURNING name`);
      if ((m as any).rows?.length > 0) {
        const ins = await tx.execute(sql`
          INSERT INTO follows (follower_user_id, following_user_id)
          SELECT s.a, s.b FROM (
            SELECT f.requester_id AS a, f.recipient_id AS b FROM friends f
              WHERE f.status = 'accepted' AND f.requester_id <> f.recipient_id
            UNION
            SELECT f.recipient_id AS a, f.requester_id AS b FROM friends f
              WHERE f.status = 'accepted' AND f.requester_id <> f.recipient_id
          ) s
          WHERE NOT EXISTS (
            SELECT 1 FROM blocks bl
            WHERE (bl.blocker_id = s.a AND bl.blocked_user_id = s.b)
               OR (bl.blocker_id = s.b AND bl.blocked_user_id = s.a))
          ON CONFLICT (follower_user_id, following_user_id) DO NOTHING`);
        // Safety net for any env where an earlier merge ran without the block
        // filter: remove follow rows between blocked pairs.
        const del = await tx.execute(sql`
          DELETE FROM follows f USING blocks bl
          WHERE (bl.blocker_id = f.follower_user_id AND bl.blocked_user_id = f.following_user_id)
             OR (bl.blocker_id = f.following_user_id AND bl.blocked_user_id = f.follower_user_id)`);
        console.log(`[Friends Merge] Converted legacy friendships into mutual follows (+${(ins as any).rowCount ?? 0} follow rows, -${(del as any).rowCount ?? 0} blocked-pair rows)`);
      }
    });
  } catch (error) {
    console.error('Startup migration (friends→follows merge) failed:', error);
  }

  // One-time startup backfill: retroactive feed events (first cards, milestones,
  // recent badges/binders/images). Idempotent via dedupe-key ON CONFLICT, but
  // gated by a startup_migrations marker so the scan only runs once per env.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    // Image-approved events were originally emitted one per image; they now
    // collapse to one per uploader per day (UTC, matching the emit sites'
    // toISOString date). Rekey any env that already has per-image events:
    // delete the old-style rows and re-open the backfill marker so the daily
    // aggregates get rebuilt. Transactional so a crash can't strand us keyless.
    await db.transaction(async (tx) => {
      const m = await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES ('feed_image_daily_v1') ON CONFLICT (name) DO NOTHING RETURNING name`);
      if ((m as any).rows?.length > 0) {
        const del = await tx.execute(sql`DELETE FROM feed_events WHERE event_type = 'image_approved' AND dedupe_key ~ '^image_approved:[0-9]+:[0-9]+$'`);
        await tx.execute(sql`DELETE FROM startup_migrations WHERE name = 'feed_backfill_v1'`);
        console.log(`[Feed] Rekeyed image-approved events to daily aggregates (removed ${(del as any).rowCount ?? 0} per-image events)`);
      }
    });
    const marker = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = 'feed_backfill_v1'`);
    if ((marker as any).rows?.length === 0) {
      const { runFeedBackfill } = await import('./services/feedService');
      const result = await runFeedBackfill(false);
      await db.execute(sql`INSERT INTO startup_migrations (name) VALUES ('feed_backfill_v1') ON CONFLICT (name) DO NOTHING`);
      console.log('Startup backfill: feed events backfilled', JSON.stringify(result));
    }
  } catch (error) {
    console.error('Startup backfill (feed events) failed:', error);
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

  // Idempotent startup migration: soft-archive columns for duplicate card cleanup.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived_at timestamp`);
    await db.execute(sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS archive_reason text`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cards_archived_at ON cards (archived_at) WHERE archived_at IS NOT NULL`);
  } catch (error) {
    console.error('Startup migration (cards archive columns) failed:', error);
  }

  // Idempotent startup migration: fast text-search (trigram) support.
  // Ensures pg_trgm + the search indexes exist in any environment so publish
  // schema diffs never try to create them on a DB without the extension.
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS cards_name_trgm_idx ON cards USING gin (name gin_trgm_ops)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS cards_variation_trgm_idx ON cards USING gin (variation gin_trgm_ops)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS card_sets_name_trgm_idx ON card_sets USING gin (name gin_trgm_ops)`);
  } catch (error) {
    console.error('Startup migration (pg_trgm search indexes) failed:', error);
  }

  // Heavy data-fix seeds are deferred until AFTER the server is listening —
  // in production these can take minutes of real work on first run, and the
  // deployer only waits ~60s for port 5000 to open (a 2026-08-13 publish
  // failed exactly this way). All are idempotent, marker-gated, and
  // advisory-locked, so running them post-listen (and concurrently across
  // autoscale instances) is safe; requests arriving before they finish just
  // see pre-fix data briefly.
  // Until the deferred data-fix seeds finish, reject card/collection/wishlist/
  // binder WRITES with a 503 so nobody can attach a card that a seed is about
  // to archive or merge away (reads stay open; seeds are sub-second no-ops
  // once their markers exist, so this window only matters on a first run).
  let dataFixSeedsDone = false;
  app.use((req, res, next) => {
    if (
      !dataFixSeedsDone &&
      req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' &&
      /^\/api\/(collection|wishlist|pc-binders|cards)(\/|$)/.test(req.path)
    ) {
      return res.status(503).json({ message: 'The Vault is finishing a quick data update — please try again in a moment.' });
    }
    next();
  });

  const runDataFixSeeds = async () => {
    // Idempotent startup repair: restore curated card images that the Aug 4
    // legacy duplicate-set merge left on the archived twin (ledger-guarded,
    // never re-touches a card an admin fixed by hand).
    try {
      const { restoreTwinMergeImages } = await import('./seeds/restoreTwinMergeImages');
      await restoreTwinMergeImages();
    } catch (error) {
      console.error('Startup repair (merge image restore) failed:', error);
    }

    // Idempotent startup fix: 2025 Topps Chrome Marvel Studios checklist —
    // completes the 200-card base + parallels, relocates mislabeled parallel
    // strays, dedupes The Snap Variations (slug-matched, safe in dev and prod).
    try {
      const { fixTcms2025Checklist } = await import('./seeds/fixTcms2025Checklist');
      await fixTcms2025Checklist();
    } catch (error) {
      console.error('Startup fix (TCMS 2025 checklist) failed:', error);
    }

    // Idempotent startup fix: 2025 Topps Chrome Marvel Studios INSERT sets —
    // strips "[Color]"/"#XX-N" decorations from card names, moving each row to
    // its correct insert/parallel set or merging it into the existing clean row
    // (slug-matched, marker-gated, safe in dev and prod).
    try {
      const { fixTcms2025Inserts } = await import('./seeds/fixTcms2025Inserts');
      await fixTcms2025Inserts();
    } catch (error) {
      console.error('Startup fix (TCMS 2025 inserts) failed:', error);
    }

    // Idempotent startup fix: parallel cards that leaked into base/insert set
    // checklists across all products — moves them to their correct parallel sets
    // (creating sets where missing), strips self-labelling decorations, and
    // archives ambiguous Printing Plate entries (marker-gated, dev + prod safe).
    try {
      const { fixParallelLeaks } = await import('./seeds/fixParallelLeaks');
      await fixParallelLeaks();
    } catch (error) {
      console.error('Startup fix (parallel leaks) failed:', error);
    } finally {
      // Always lift the write gate — a failed seed retries next boot, and
      // blocking user writes indefinitely would be worse than the race.
      dataFixSeedsDone = true;
    }
  };

  // Idempotent startup fix: user collection/wishlist/binder rows still pointing
  // at archived (merged-away) cards — repoints them to the canonical card
  // embedded in archive_reason, merging quantities where the user already owns
  // the canonical (prod had ~39 such rows from the legacy set-merge passes).
  try {
    const { fixArchivedCollectionRows } = await import('./seeds/fixArchivedCollectionRows');
    await fixArchivedCollectionRows();
  } catch (error) {
    console.error('Startup fix (archived collection rows) failed:', error);
  }

  const server = await registerRoutes(app);

  // Start background services
  console.log('Starting background services...');
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

    // Kick off the heavy data-fix seeds now that the port is open (see
    // runDataFixSeeds above — deferred so slow first runs can't fail the
    // deploy health check).
    runDataFixSeeds().catch((error) => {
      console.error('Deferred data-fix seeds failed:', error);
    });


    // Nightly pricing backfill: prices cards that have an image but no
    // pricing data yet — up to 1,000/night at 3 AM CT (see ebay-pricing.ts).
    import('./ebay-pricing').then(({ startNightlyPricingBackfillCron }) => {
      startNightlyPricingBackfillCron();
    }).catch((error) => {
      console.error('Failed to start nightly pricing backfill cron:', error);
    });

    // External → Cloudinary image migration worker: continuously (paced)
    // copies all externally-hosted card images (PriceCharting, COMC, eBay, …)
    // into our Cloudinary account until none remain (see services/imageMigration.ts).
    import('./services/imageMigration').then(({ startImageMigrationWorker }) => {
      startImageMigrationWorker();
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

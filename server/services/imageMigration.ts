import { db } from '../db';
import { cards } from '../../shared/schema';
import { sql, eq, and } from 'drizzle-orm';
import { cloudinary } from '../cloudinary';

/**
 * External → Cloudinary card image migration (all hosts, one pipeline).
 *
 * Any active card whose front/back image URL points at an external host
 * (PriceCharting/googleapis, COMC, eBay, etc.) gets its image copied into our
 * Cloudinary account and the card row updated to the Cloudinary URL. The URL
 * swap happens ONLY after Cloudinary confirms a successful upload, so a failed
 * attempt can never break an image that works today.
 *
 * Host specifics:
 * - PriceCharting (storage.googleapis.com/images.pricecharting.com/…/240.jpg):
 *   we try larger renditions (1600 → 500) before falling back to the stored
 *   size, so migrated images are sharper than what we hotlink today.
 * - COMC (img.comc.com): Cloudflare bot protection 403s our server (July 2026),
 *   but Cloudinary's remote fetcher is not blocked — so ALL uploads go through
 *   Cloudinary's remote fetch rather than downloading ourselves.
 *
 * Permanent failures: attempts are persisted in image_migration_failures.
 * After MAX_ATTEMPTS failed attempts (spread across runs/boots) the dead URL
 * is cleared to NULL ("no image") and recorded as status='cleared', so binders
 * show the name placeholder instead of a broken frame. The ledger doubles as
 * the report of what was cleared.
 *
 * Safety / resumability:
 * - Postgres advisory lock so only one instance migrates at a time.
 * - Progress is derived from the cards table itself (non-Cloudinary URL =
 *   still pending), so the job is idempotent and resumes after any restart.
 * - Paced (DELAY_MS between cards) and processes one card at a time.
 * - Aborts after MAX_CONSECUTIVE_FAILURES (service outage) instead of hammering.
 * - Worker starts shortly after boot and keeps going until nothing remains.
 */

const DELAY_MS = parseInt(
  process.env.IMAGE_MIGRATION_DELAY_MS ||
  (process.env.NODE_ENV === 'development' ? '250' : '750'),
);
const MAX_CONSECUTIVE_FAILURES = 25;
const UPLOAD_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3; // per URL before it's declared dead and cleared
const BATCH_SIZE = 200;
const LOCK_KEY = 'external-image-migration';

// External-URL predicate shared by the picker query and the remaining count.
const EXTERNAL_FRONT = sql`(front_image_url IS NOT NULL AND front_image_url != '' AND front_image_url NOT LIKE '%cloudinary.com%' AND front_image_url NOT LIKE '/uploads/%')`;
const EXTERNAL_BACK = sql`(back_image_url IS NOT NULL AND back_image_url != '' AND back_image_url NOT LIKE '%cloudinary.com%' AND back_image_url NOT LIKE '/uploads/%')`;
const PENDING_WHERE = sql`archived_at IS NULL AND (${EXTERNAL_FRONT} OR ${EXTERNAL_BACK})`;

let running = false;
let stopRequested = false;
let bootStats = { attempted: 0, migrated: 0, failed: 0, cleared: 0 };
let lastRun: { at: Date; attempted: number; migrated: number; failed: number; cleared: number; remaining: number } | null = null;

export function getImageMigrationStatus() {
  return { running, thisBoot: bootStats, lastRun };
}

export function requestImageMigrationStop() {
  stopRequested = true;
}

async function ensureLedgerTable(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS image_migration_failures (
    card_id integer NOT NULL,
    side text NOT NULL,
    url text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'retrying',
    last_error text,
    updated_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (card_id, side)
  )`);
}

/**
 * Cloudinary rejects uploads with plain error OBJECTS (e.g. { message,
 * http_code }), not Error instances — String(error) yields "[object Object]",
 * which hid every 404 from isPermanentFailure() and blocked clearing. Extract
 * a real message (including the HTTP code) from whatever shape we get.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const e = error as any;
  const msg = e?.message ?? e?.error?.message;
  const code = e?.http_code ?? e?.error?.http_code;
  if (msg || code) return [msg, code ? `(HTTP ${code})` : null].filter(Boolean).join(' ');
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return String(error);
  }
}

/** For PriceCharting images, candidate URLs from sharpest to stored size. */
function candidateUrls(url: string): string[] {
  const m = url.match(/^(https?:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/.*\/)(\d+)(\.jpg)$/);
  if (m) {
    const sizes = ['1600', '500'];
    const list = sizes.filter((s) => s !== m[2]).map((s) => `${m[1]}${s}${m[3]}`);
    list.push(url);
    return list;
  }
  return [url];
}

/** Upload one external URL via Cloudinary remote fetch; returns secure_url. */
async function uploadOne(url: string, cardId: number, side: 'front' | 'back', timeoutMs: number = UPLOAD_TIMEOUT_MS): Promise<string> {
  let lastError: unknown;
  for (const candidate of candidateUrls(url)) {
    try {
      const result = await cloudinary.uploader.upload(candidate, {
        folder: 'marvel-cards/external-migration',
        public_id: `card_${cardId}_${side}`,
        overwrite: true,
        resource_type: 'image',
        timeout: timeoutMs,
        transformation: [
          { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
          { format: 'auto' },
        ],
      });
      if (!result?.secure_url) throw new Error('Cloudinary returned no URL');
      return result.secure_url;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(toErrorMessage(lastError));
}

/**
 * Only definitive "this URL is dead" failures may ever lead to clearing an
 * image. Timeouts, 5xx, rate limits, and network errors are transient — they
 * update the cooldown timestamp but never increment the permanent counter,
 * so an upstream/Cloudinary outage can never erase healthy URLs.
 */
function isPermanentFailure(message: string): boolean {
  return /\b(404|410)\b|not\s*found|resource not found|invalid image file|unsupported.*format/i.test(message);
}

async function recordFailure(cardId: number, side: 'front' | 'back', url: string, error: string, permanent: boolean): Promise<number> {
  const increment = permanent ? 1 : 0;
  const res = await db.execute(sql`
    INSERT INTO image_migration_failures (card_id, side, url, attempts, status, last_error, updated_at)
    VALUES (${cardId}, ${side}, ${url}, ${increment}, 'retrying', ${error.slice(0, 500)}, now())
    ON CONFLICT (card_id, side) DO UPDATE
      SET attempts = image_migration_failures.attempts + ${increment},
          url = EXCLUDED.url,
          last_error = EXCLUDED.last_error,
          updated_at = now()
    RETURNING attempts
  `);
  return parseInt((res.rows[0] as any)?.attempts ?? '0');
}

/** Migrate one card's external front/back images. Returns per-card outcome. */
async function migrateCard(card: { id: number; frontImageUrl: string | null; backImageUrl: string | null }): Promise<'migrated' | 'failed' | 'cleared'> {
  let outcome: 'migrated' | 'failed' | 'cleared' = 'migrated';
  for (const side of ['front', 'back'] as const) {
    const url = side === 'front' ? card.frontImageUrl : card.backImageUrl;
    if (!url || url.includes('cloudinary.com') || url.startsWith('/uploads/')) continue;
    const column = side === 'front' ? 'frontImageUrl' : 'backImageUrl';
    try {
      const secureUrl = await uploadOne(url, card.id, side);
      // Guarded write: only swap the URL if the card still holds the exact
      // URL we uploaded from — an admin may have saved a new image meanwhile.
      await db.update(cards).set({ [column]: secureUrl })
        .where(and(eq(cards.id, card.id), eq(side === 'front' ? cards.frontImageUrl : cards.backImageUrl, url)));
      await db.execute(sql`DELETE FROM image_migration_failures WHERE card_id = ${card.id} AND side = ${side}`);
    } catch (error) {
      const message = toErrorMessage(error);
      const permanent = isPermanentFailure(message);
      const attempts = await recordFailure(card.id, side, url, message, permanent);
      if (permanent && attempts >= MAX_ATTEMPTS) {
        // Confirmed dead: clear to "no image" instead of leaving a broken URL.
        // Guarded: only clear if the card still holds the dead URL.
        await db.update(cards).set({ [column]: null })
          .where(and(eq(cards.id, card.id), eq(side === 'front' ? cards.frontImageUrl : cards.backImageUrl, url)));
        await db.execute(sql`UPDATE image_migration_failures SET status = 'cleared', updated_at = now() WHERE card_id = ${card.id} AND side = ${side}`);
        console.warn(`[ImageMigration] Card ${card.id} ${side} cleared after ${attempts} failed attempts: ${url}`);
        if (outcome !== 'failed') outcome = 'cleared';
      } else {
        console.error(`[ImageMigration] Card ${card.id} ${side} failed (attempt ${attempts}): ${message}`);
        outcome = 'failed';
      }
    }
  }
  return outcome;
}

/**
 * Immediately re-host a card's external image URLs to Cloudinary right after
 * an admin save, instead of waiting for the 6-hourly background worker.
 * Best-effort: on failure the external URL is kept (the worker retries later)
 * and the save itself is never blocked or reverted.
 * Returns the card's final front/back URLs (Cloudinary if re-hosted).
 */
const REHOST_NOW_TIMEOUT_MS = 15_000; // keep admin saves snappy; worker retries slow ones

export async function rehostCardImagesNow(cardId: number): Promise<{ frontImageUrl: string | null; backImageUrl: string | null } | null> {
  const [card] = await db.select({ id: cards.id, frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl })
    .from(cards).where(eq(cards.id, cardId));
  if (!card) return null;
  for (const side of ['front', 'back'] as const) {
    const url = side === 'front' ? card.frontImageUrl : card.backImageUrl;
    if (!url || url.includes('cloudinary.com') || url.startsWith('/uploads/')) continue;
    const column = side === 'front' ? 'frontImageUrl' : 'backImageUrl';
    try {
      const secureUrl = await uploadOne(url, card.id, side, REHOST_NOW_TIMEOUT_MS);
      // Guarded write: only swap if the card still holds the URL we uploaded
      // from — a concurrent save/worker run may have changed it meanwhile.
      await db.update(cards).set({ [column]: secureUrl })
        .where(and(eq(cards.id, card.id), eq(side === 'front' ? cards.frontImageUrl : cards.backImageUrl, url)));
      console.log(`[ImageRehost] Card ${card.id} ${side} re-hosted on save: ${url} -> ${secureUrl}`);
    } catch (error) {
      // Keep the external URL; the background worker will retry within 6h.
      console.error(`[ImageRehost] Card ${card.id} ${side} immediate re-host failed (worker will retry): ${toErrorMessage(error)}`);
    }
  }
  // Re-read so the caller returns the true final state, not a stale merge.
  const [fresh] = await db.select({ frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl })
    .from(cards).where(eq(cards.id, cardId));
  return fresh ?? null;
}

async function countRemaining(): Promise<number> {
  const res = await db.execute(sql`SELECT COUNT(*) AS remaining FROM cards WHERE ${PENDING_WHERE}`);
  return parseInt((res.rows[0] as any)?.remaining ?? '-1');
}

/**
 * Run the migration until done (maxCards = Infinity) or up to maxCards cards.
 * Resumable: derives its worklist live from the cards table each batch.
 */
export async function runImageMigrationBatch(maxCards: number = Number.POSITIVE_INFINITY): Promise<void> {
  if (running) {
    console.warn('[ImageMigration] Already running — skipping');
    return;
  }
  running = true;
  stopRequested = false;
  let attempted = 0, migrated = 0, failed = 0, cleared = 0;
  let lockAcquired = false;

  try {
    await ensureLedgerTable();

    const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(hashtext(${LOCK_KEY})) AS locked`);
    lockAcquired = Boolean((lockResult.rows[0] as any)?.locked);
    if (!lockAcquired) {
      console.log('[ImageMigration] Another instance holds the lock — skipping on this instance');
      return;
    }

    let consecutiveFailures = 0;

    outer: while (attempted < maxCards && !stopRequested) {
      // Skip URLs still cooling down: rows with a 'retrying' ledger entry
      // updated in the last 6h wait for a later pass, so a cluster of flaky
      // URLs can't stall the queue; random order spreads load across hosts.
      const batch = await db.execute(sql`
        SELECT c.id, c.front_image_url AS "frontImageUrl", c.back_image_url AS "backImageUrl"
        FROM cards c
        WHERE ${PENDING_WHERE}
          AND NOT EXISTS (
            SELECT 1 FROM image_migration_failures f
            WHERE f.card_id = c.id AND f.status = 'retrying' AND f.updated_at > now() - interval '6 hours'
          )
        ORDER BY random()
        LIMIT ${Math.min(BATCH_SIZE, maxCards - attempted)}
      `);
      const targets = batch.rows as any[];
      if (targets.length === 0) break;

      for (const card of targets) {
        if (stopRequested || attempted >= maxCards) break outer;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`[ImageMigration] ${consecutiveFailures} consecutive failures — aborting run (likely outage)`);
          break outer;
        }
        attempted++;
        bootStats.attempted++;
        const outcome = await migrateCard(card);
        if (outcome === 'migrated') { migrated++; bootStats.migrated++; consecutiveFailures = 0; }
        else if (outcome === 'cleared') { cleared++; bootStats.cleared++; consecutiveFailures = 0; }
        else { failed++; bootStats.failed++; consecutiveFailures++; }
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    const remaining = await countRemaining();
    lastRun = { at: new Date(), attempted, migrated, failed, cleared, remaining };
    console.log(`[ImageMigration] Run finished: ${migrated} migrated, ${cleared} cleared, ${failed} failed of ${attempted} attempted. ${remaining} cards with external images remain.`);
  } catch (error) {
    console.error('[ImageMigration] Run aborted:', error);
    lastRun = { at: new Date(), attempted, migrated, failed, cleared, remaining: -1 };
  } finally {
    running = false;
    if (lockAcquired) {
      try {
        await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${LOCK_KEY}))`);
      } catch (unlockError) {
        console.error('[ImageMigration] Failed to release advisory lock:', unlockError);
      }
    }
  }
}

let workerStarted = false;

/**
 * Start the background worker: waits 60s after boot, then migrates
 * continuously (paced) until no external image URLs remain. Re-checks every
 * 6h so retry-cooldown URLs get their later attempts without a redeploy.
 */
export function startImageMigrationWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const kick = () => {
    runImageMigrationBatch().catch((error) => console.error('[ImageMigration] Worker error:', error));
  };
  setTimeout(kick, 60_000);
  setInterval(kick, 6 * 60 * 60 * 1000).unref();
  console.log(`[ImageMigration] Worker scheduled: starts 60s after boot, paced ${DELAY_MS}ms/card, until all external card images are on Cloudinary`);
}

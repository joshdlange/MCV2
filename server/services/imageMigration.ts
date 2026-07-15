import { CronJob } from 'cron';
import fetch from 'node-fetch';
import { db } from '../db';
import { cards } from '../../shared/schema';
import { sql, eq, or, like, notInArray, and } from 'drizzle-orm';
import { cloudinary } from '../cloudinary';

/**
 * Nightly COMC → Cloudinary image migration.
 *
 * ~10.8k cards still hotlink images from img.comc.com. If COMC ever changes or
 * removes those URLs we lose the images, so this job gradually copies each one
 * into our own Cloudinary account and swaps the card's URL to the Cloudinary
 * copy. The URL swap happens ONLY after Cloudinary confirms a successful
 * upload, so a failed night can never break an image that works today.
 *
 * Load safety (per user requirement: must not slow anything down):
 * - Runs at 1:30 AM CT, before the 3 AM pricing backfill, so the two nightly
 *   jobs never stack.
 * - Paced 4s per card (~450 cards in 30 min) — one small download + one
 *   Cloudinary upload at a time, never parallel.
 * - Postgres advisory lock so only one autoscale instance runs it.
 * - Aborts the run after 25 consecutive failures (e.g. COMC or Cloudinary
 *   outage) instead of hammering a broken service all night.
 * - Cards that fail are remembered in-process and skipped on later runs, so a
 *   handful of dead URLs can't block the queue (memory resets on redeploy,
 *   which gives dead URLs an occasional retry — intentional).
 */

const NIGHTLY_LIMIT = 450;
const DELAY_MS = 4_000;
const MAX_CONSECUTIVE_FAILURES = 25;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const RUN_CUTOFF_MS = 80 * 60 * 1000; // hard stop after 80 min so we never overlap the 3 AM pricing job
const LOCK_KEY = 'nightly-image-migration';
const COMC_MATCH = '%comc.com%';

let migrationRunning = false;
let migrationLastRun: {
  at: Date;
  attempted: number;
  migrated: number;
  failed: number;
  remaining: number;
} | null = null;
const skipCardIds = new Set<number>();

export function getImageMigrationStatus() {
  return { running: migrationRunning, lastRun: migrationLastRun, skippedThisBoot: skipCardIds.size };
}

/** Download from COMC (which allows direct fetches) and upload the bytes to Cloudinary. */
async function migrateOneUrl(url: string, cardId: number, side: 'front' | 'back'): Promise<string> {
  const controller = new AbortController();
  const downloadTimer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal as any,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(downloadTimer);
  }
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('Empty image response');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`Image too large: ${buffer.length} bytes`);

  const result = await cloudinary.uploader.upload(
    `data:${contentType};base64,${buffer.toString('base64')}`,
    {
      folder: 'marvel-cards/comc-migration',
      public_id: `card_${cardId}_${side}`,
      overwrite: true,
      resource_type: 'image',
      timeout: UPLOAD_TIMEOUT_MS,
      transformation: [
        { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
        { format: 'auto' },
      ],
    },
  );
  if (!result?.secure_url) throw new Error('Cloudinary returned no URL');
  return result.secure_url;
}

export async function runImageMigrationBatch(maxCards: number = NIGHTLY_LIMIT): Promise<void> {
  if (migrationRunning) {
    console.warn('[ImageMigration] Previous run still in progress — skipping');
    return;
  }
  migrationRunning = true;
  let attempted = 0;
  let migrated = 0;
  let failed = 0;
  let remaining = -1;
  let lockAcquired = false;

  try {
    const lockResult = await db.execute(
      sql`SELECT pg_try_advisory_lock(hashtext(${LOCK_KEY})) AS locked`,
    );
    lockAcquired = Boolean((lockResult.rows[0] as any)?.locked);
    if (!lockAcquired) {
      console.log('[ImageMigration] Another instance holds the lock — skipping on this instance');
      return;
    }

    const comcCondition = or(
      like(cards.frontImageUrl, COMC_MATCH),
      like(cards.backImageUrl, COMC_MATCH),
    );

    // Exclude cards that already failed since this boot (cap the NOT IN list
    // to keep the query sane — random ordering below makes stragglers harmless).
    const skipIds = Array.from(skipCardIds).slice(0, 5000);
    const whereClause = skipIds.length > 0
      ? and(comcCondition, notInArray(cards.id, skipIds))
      : comcCondition;

    // Random order guarantees forward progress: a cluster of permanently-bad
    // URLs at low ids can never monopolize every night's batch.
    const targets = await db
      .select({ id: cards.id, frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl })
      .from(cards)
      .where(whereClause)
      .orderBy(sql`random()`)
      .limit(maxCards);

    if (targets.length === 0) {
      console.log('[ImageMigration] No COMC-hosted images remain — migration complete');
      remaining = 0;
      return;
    }

    console.log(`[ImageMigration] Starting batch: ${targets.length} cards`);
    let consecutiveFailures = 0;
    const runStartedAt = Date.now();

    for (const card of targets) {
      if (Date.now() - runStartedAt > RUN_CUTOFF_MS) {
        console.log(`[ImageMigration] Run cutoff (${RUN_CUTOFF_MS / 60000} min) reached after ${attempted} cards — stopping for tonight`);
        break;
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`[ImageMigration] ${consecutiveFailures} consecutive failures — aborting run (likely COMC/Cloudinary outage)`);
        break;
      }
      attempted++;
      try {
        const updates: Partial<{ frontImageUrl: string; backImageUrl: string }> = {};
        if (card.frontImageUrl?.includes('comc.com')) {
          updates.frontImageUrl = await migrateOneUrl(card.frontImageUrl, card.id, 'front');
        }
        if (card.backImageUrl?.includes('comc.com')) {
          updates.backImageUrl = await migrateOneUrl(card.backImageUrl, card.id, 'back');
        }
        if (Object.keys(updates).length > 0) {
          await db.update(cards).set(updates).where(eq(cards.id, card.id));
        }
        migrated++;
        consecutiveFailures = 0;
      } catch (error) {
        failed++;
        consecutiveFailures++;
        skipCardIds.add(card.id);
        console.error(`[ImageMigration] Card ${card.id} failed:`, error instanceof Error ? error.message : error);
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    const remainingResult = await db.execute(sql`
      SELECT COUNT(*) AS remaining FROM cards
      WHERE front_image_url LIKE ${COMC_MATCH} OR back_image_url LIKE ${COMC_MATCH}
    `);
    remaining = parseInt((remainingResult.rows[0] as any)?.remaining ?? '-1');

    console.log(`[ImageMigration] Done: ${migrated} migrated, ${failed} failed of ${attempted} attempted. ${remaining} COMC images remain.`);
  } catch (error) {
    console.error('[ImageMigration] Run aborted:', error);
  } finally {
    migrationRunning = false;
    migrationLastRun = { at: new Date(), attempted, migrated, failed, remaining };
    if (lockAcquired) {
      try {
        await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${LOCK_KEY}))`);
      } catch (unlockError) {
        console.error('[ImageMigration] Failed to release advisory lock:', unlockError);
      }
    }
  }
}

let migrationCronStarted = false;

export function startImageMigrationCron(): void {
  if (migrationCronStarted) return;
  migrationCronStarted = true;

  const job = new CronJob(
    '30 1 * * *', // 1:30 AM CT daily — finishes well before the 3 AM pricing backfill
    async () => {
      try {
        await runImageMigrationBatch();
      } catch (error) {
        console.error('[ImageMigration] Cron error:', error);
      }
    },
    null,
    false,
    'America/Chicago',
  );
  job.start();
  console.log(`[ImageMigration] Cron started: daily 1:30 AM CT, up to ${NIGHTLY_LIMIT} COMC images/night`);
}

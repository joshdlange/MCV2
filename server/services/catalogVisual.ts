import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { downloadCatalogReference } from './catalogVisualFetch';
import { embedCatalogVisualImage, MODEL_VERSION, normalizeVisualVector, visualTopK } from './catalogVisualModel';

export { MODEL_VERSION } from './catalogVisualModel';
export type CatalogVisualResult = {
  status: 'ready' | 'partial' | 'unavailable';
  matches: { cardId: number; similarity: number }[];
  indexedCount: number;
  totalEligible: number;
  error?: string;
};

// Shared "no image yet" asset (thousands of unrelated cards); never a visual reference.
export const PLACEHOLDER_IMAGE_FILE = 'card-placeholder_ysozlo\\.png';
// Eligibility is independent of OCR, card number, name and user-upload history.
export const CATALOG = `FROM cards c JOIN card_sets s ON s.id=c.set_id
  LEFT JOIN main_sets m ON m.id=s.main_set_id`;
export const ELIGIBLE = `c.archived_at IS NULL AND s.is_active AND s.archived_at IS NULL
  AND (m.id IS NULL OR (m.is_active AND m.archived_at IS NULL))
  AND c.front_image_url ~ '^https?://'
  AND c.front_image_url !~* '^https?://([^/]*\\.)?(drive\\.google\\.com|docs\\.google\\.com|googleusercontent\\.com)(/|:)'
  AND c.front_image_url !~* '/${PLACEHOLDER_IMAGE_FILE}$'`;
const MAX_REFERENCES = 100_000; // ~154 MB of Float32 vectors; capacity is reported explicitly.
const CACHE_TTL_MS = 60_000;
const MAX_BATCH = 32;
type Reference = { url: string; vector: Float32Array };
let cache: { references: Reference[]; indexedCount: number; totalEligible: number; at: number } | undefined;
let refreshing: Promise<NonNullable<typeof cache>> | undefined;
let running = false;
let activeQueries = 0;
let lastError: string | undefined;
let lastBatch = { attempted: 0, indexed: 0, failed: 0 };
const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : 'Catalog visual operation failed';
export const VISUAL_INDEX_LOCK = 734822019;
export const visualReferenceKey = (url: string) => createHash('sha256').update(`${MODEL_VERSION}\n${url}`).digest('hex');
export const visualContentDigest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

export async function saveVisualReference(client: PoolClient, url: string, digest: string, embedding: number[]) {
  await client.query(`INSERT INTO catalog_visual_references
    (key,model_version,reference_url,content_digest,embedding,status,attempts)
    VALUES ($1,$2,$3,$4,$5::jsonb,'ready',1)
    ON CONFLICT (key) DO UPDATE SET content_digest=EXCLUDED.content_digest,
      embedding=EXCLUDED.embedding,status='ready',attempts=catalog_visual_references.attempts+1,
      last_error=NULL,retry_at=NULL,updated_at=now()`,
  [visualReferenceKey(url), MODEL_VERSION, url, digest, JSON.stringify(embedding)]);
}

export async function failVisualReference(client: PoolClient, url: string, error: unknown) {
  const reason = message(error).replace(/https?:\/\/\S+/g, '[reference URL]');
  await client.query(`INSERT INTO catalog_visual_references
    (key,model_version,reference_url,status,attempts,last_error,retry_at)
    VALUES ($1,$2,$3,'failed',1,$4,now()+interval '5 minutes')
    ON CONFLICT (key) DO UPDATE SET status='failed',attempts=catalog_visual_references.attempts+1,
      last_error=EXCLUDED.last_error,updated_at=now(),
      retry_at=now()+interval '5 minutes'*power(2,least(catalog_visual_references.attempts,8))`,
  [visualReferenceKey(url), MODEL_VERSION, url, reason]);
}

async function loadCache() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const references: Reference[] = [];
    let cursor = '';
    // Page JSON decoding to bound temporary allocations during a cache refresh.
    while (references.length < MAX_REFERENCES) {
      const result = await pool.query(`SELECT r.key, r.reference_url, r.embedding
        FROM catalog_visual_references r WHERE r.model_version=$1 AND r.status='ready' AND r.key > $2
        AND EXISTS (SELECT 1 ${CATALOG} WHERE ${ELIGIBLE} AND c.front_image_url=r.reference_url)
        ORDER BY r.key LIMIT $3`, [MODEL_VERSION, cursor, Math.min(500, MAX_REFERENCES - references.length)]);
      for (const row of result.rows) references.push({
        url: row.reference_url, vector: new Float32Array(normalizeVisualVector(row.embedding)),
      });
      if (!result.rows.length) break;
      cursor = result.rows[result.rows.length - 1].key;
    }
    const counts = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE c.front_image_url=ANY($1::text[]))::int AS indexed
      ${CATALOG} WHERE ${ELIGIBLE}`, [references.map(ref => ref.url)]);
    cache = { references, totalEligible: counts.rows[0].total, indexedCount: counts.rows[0].indexed, at: Date.now() };
    return cache;
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}

export async function queryCatalogByImage(buffer: Buffer, limit = 20): Promise<CatalogVisualResult> {
  if (activeQueries >= 2) return {
    status: 'unavailable', matches: [], indexedCount: cache?.indexedCount ?? 0,
    totalEligible: cache?.totalEligible ?? 0, error: 'Visual search busy; retry shortly.',
  };
  activeQueries++;
  try {
    const snapshot = await loadCache();
    const { indexedCount, totalEligible } = snapshot;
    if (!snapshot.references.length) return {
      status: 'unavailable', matches: [], indexedCount, totalEligible,
      error: 'Catalog visual index has no current references; indexing is required.',
    };
    const vector = await embedCatalogVisualImage(buffer);
    const take = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
    // Exact cosine search over every loaded catalog reference, no text prefilter.
    // Streaming heap retains at most 200 candidates, not a full allocation/sort.
    // Overfetch allows live stale-reference filtering without unbounded DB reads.
    const ranked = visualTopK(snapshot.references, vector, Math.max(100, take * 4));
    // Resolve live catalog IDs after ranking. This immediately excludes archived
    // cards/sets and changed URLs even when the vector cache has not yet expired.
    const matches: CatalogVisualResult['matches'] = [];
    for (let offset = 0; offset < ranked.length && matches.length < take; offset += 100) {
      const slice = ranked.slice(offset, offset + 100);
      const scores = new Map(slice.map(ref => [ref.url, ref.similarity]));
      const current = await pool.query(`SELECT c.id, c.front_image_url ${CATALOG}
        WHERE ${ELIGIBLE} AND c.front_image_url=ANY($1::text[]) ORDER BY c.id LIMIT 10000`,
      [slice.map(ref => ref.url)]);
      matches.push(...current.rows.map(row => ({ cardId: row.id, similarity: scores.get(row.front_image_url)! })));
      matches.sort((a, b) => b.similarity - a.similarity || a.cardId - b.cardId);
    }
    return {
      status: indexedCount === totalEligible ? 'ready' : 'partial',
      matches: matches.slice(0, take), indexedCount, totalEligible,
    };
  } catch (error) {
    lastError = message(error);
    return { status: 'unavailable', matches: [], indexedCount: cache?.indexedCount ?? 0,
      totalEligible: cache?.totalEligible ?? 0, error: lastError };
  } finally { activeQueries--; }
}

/** Bounded, idempotent batch. Durable failures retry with backoff up to 5 times.
 * Session advisory lock serializes replicas; connection loss releases ownership.
 * Only catalog-selected URLs can enter the index. Never receives uploaded bytes.
 */
export async function buildCatalogVisualIndexBatch(batchSize = 16) {
  if (running) return { ...lastBatch, busy: true };
  running = true;
  const stats = { attempted: 0, indexed: 0, failed: 0 };
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    locked = (await client.query("SELECT pg_try_advisory_lock($1) AS locked", [VISUAL_INDEX_LOCK])).rows[0].locked;
    if (!locked) return { ...stats, busy: true };
    const size = Number.isFinite(batchSize) ? Math.min(MAX_BATCH, Math.max(1, Math.floor(batchSize))) : 16;
    const candidates = await client.query(`SELECT c.front_image_url AS url, min(c.id) AS first_id
      ${CATALOG} LEFT JOIN catalog_visual_references r
      ON r.reference_url=c.front_image_url AND r.model_version=$1
      WHERE ${ELIGIBLE} AND (r.key IS NULL OR
        (r.status='failed' AND r.attempts < 5 AND r.retry_at <= now()))
      GROUP BY c.front_image_url ORDER BY min(c.id) LIMIT $2`, [MODEL_VERSION, size]);
    for (const { url } of candidates.rows) {
      stats.attempted++;
      try {
        const buffer = await downloadCatalogReference(url);
        const digest = visualContentDigest(buffer);
        const shared = await client.query(`SELECT embedding FROM catalog_visual_references
          WHERE model_version=$1 AND content_digest=$2 AND status='ready' LIMIT 1`, [MODEL_VERSION, digest]);
        const embedding = shared.rows[0]?.embedding ?? await embedCatalogVisualImage(buffer, 'background');
        await saveVisualReference(client, url, digest, embedding);
        stats.indexed++;
      } catch (error) {
        // Do not persist arbitrary URLs or credentials from network error text.
        await failVisualReference(client, url, error);
        stats.failed++;
        lastError = message(error);
      }
    }
    if (stats.indexed) cache = undefined;
    lastBatch = stats;
    return { ...stats, busy: false };
  } catch (error) {
    lastError = message(error);
    throw error;
  } finally {
    if (client) {
      try { if (locked) await client.query('SELECT pg_advisory_unlock($1)', [VISUAL_INDEX_LOCK]); }
      finally { client.release(); }
    }
    running = false;
  }
}

/** Nonblocking bounded startup/timer hook; caller owns schedule and opt-in. */
export function kickCatalogVisualIndex(batchSize = 8): void {
  if (!running) void buildCatalogVisualIndexBatch(batchSize).catch(() => {
    console.warn('[catalog-visual] Index batch unavailable; inspect visual index status');
  });
}

let workerStarted = false;
let workerTimer: ReturnType<typeof setTimeout> | undefined;
let workerFailures = 0;
let workerWarning: string | undefined;
let nextBatchAt: number | undefined;

/** Singleton, nonblocking, no startup DDL. Completion-based timers cannot pile up
 * batches on a slow network/CPU. Missing schema backs off until explicitly migrated.
 */
export function startCatalogVisualIndexWorker(): void {
  // Keep ingestion frozen until the real-photo evaluation supports this pipeline.
  if (workerStarted || process.env.CATALOG_VISUAL_INDEX_ENABLED !== 'true') return;
  workerStarted = true;
  const schedule = (delay: number) => {
    nextBatchAt = Date.now() + delay;
    workerTimer = setTimeout(tick, delay);
    workerTimer.unref();
  };
  const tick = async () => {
    let delay = 30_000;
    try {
      const result = await buildCatalogVisualIndexBatch(16);
      workerFailures = 0;
      workerWarning = undefined;
      // Completed catalog: poll less frequently for newly added/changed fronts.
      if (!result.busy && !result.attempted) delay = 5 * 60_000;
    } catch (error) {
      workerFailures++;
      const missingSchema = (error as { code?: string })?.code === '42P01';
      const warning = missingSchema ? 'missing-schema' : 'batch-failed';
      if (workerWarning !== warning) {
        console.warn(missingSchema
          ? '[catalog-visual] Reference schema missing; worker paused 15 minutes. Apply the additive schema using the verified database migration process; no automatic DDL.'
          : '[catalog-visual] Index worker failed; backing off. Inspect catalog visual status.');
        workerWarning = warning;
      }
      delay = missingSchema ? 15 * 60_000 : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(workerFailures, 5));
    } finally {
      if (workerStarted) schedule(delay);
    }
  };
  schedule(5_000);
}

export function stopCatalogVisualIndexWorker(): void {
  workerStarted = false;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = undefined;
  nextBatchAt = undefined;
}

export async function getCatalogVisualStatus() {
  let status: CatalogVisualResult['status'] = 'unavailable';
  let failedReferences = 0;
  let exhaustedReferences = 0;
  try {
    const current = await loadCache();
    const failures = await pool.query(`SELECT count(*)::int AS failed,
      count(*) FILTER (WHERE attempts >= 5)::int AS exhausted
      FROM catalog_visual_references r WHERE model_version=$1 AND status='failed'
      AND EXISTS (SELECT 1 ${CATALOG} WHERE ${ELIGIBLE} AND c.front_image_url=r.reference_url)`, [MODEL_VERSION]);
    failedReferences = failures.rows[0].failed;
    exhaustedReferences = failures.rows[0].exhausted;
    status = current.indexedCount === current.totalEligible && current.indexedCount > 0 ? 'ready'
      : current.indexedCount > 0 ? 'partial' : 'unavailable';
  } catch (error) { lastError = message(error); }
  return { status, modelVersion: MODEL_VERSION, running, indexedCount: cache?.indexedCount ?? 0,
    totalEligible: cache?.totalEligible ?? 0, cachedReferences: cache?.references.length ?? 0,
    referenceCapacity: MAX_REFERENCES, failedReferences, exhaustedReferences, lastBatch, error: lastError,
    workerStarted, nextBatchAt };
}
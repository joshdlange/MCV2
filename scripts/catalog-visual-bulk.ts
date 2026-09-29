import { pool } from '../server/db';
import {
  CATALOG, ELIGIBLE, MODEL_VERSION, VISUAL_INDEX_LOCK,
  visualContentDigest, saveVisualReference, failVisualReference,
} from '../server/services/catalogVisual';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
import { embedCatalogVisualImage } from '../server/services/catalogVisualModel';

// No production override: separate review/authorization is required to change this.
const args = process.argv.slice(2);
const readOnly = args.includes('--dry-run') || args.includes('--status');
const repair = args.includes('--repair-ready');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const batchSize = Number(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? 16);
const log = (data: object) => console.log(JSON.stringify(data));
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });

type Download = { url: string; buffer?: Buffer; error?: unknown };
async function downloadBatch(urls: string[]): Promise<Download[]> {
  const results: Download[] = new Array(urls.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      try { results[i] = { url: urls[i], buffer: await downloadCatalogReference(urls[i]) }; }
      catch (error) { results[i] = { url: urls[i], error }; }
    }
  }));
  return results;
}

async function main() {
  if (process.env.NODE_ENV !== 'development' || process.env.REPLIT_DEPLOYMENT
    || !['helium', 'localhost', '127.0.0.1', '::1'].includes(new URL(process.env.DATABASE_URL!).hostname)) {
    throw new Error('Bulk CLI requires NODE_ENV=development and a local development database; deployment/remote databases forbidden');
  }
  if (args.some(a => !/^--(dry-run|status|write|repair-ready|limit=\d+|batch-size=\d+)$/.test(a))
    || (!readOnly && !args.includes('--write'))
    || (repair && limitArg)
    || ![8, 16].includes(batchSize) || !(limit > 0) || (limit !== Infinity && !Number.isSafeInteger(limit))) {
    throw new Error('Usage: --status | --dry-run | --write [--limit=128] [--batch-size=8|16] [--repair-ready (all ready; no limit)]');
  }
  const start = Date.now();
  const client = await pool.connect();
  let locked = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; stopped = true; };
  client.on('error', onError);
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [VISUAL_INDEX_LOCK])).rows[0].locked;
    if (!locked) throw new Error('Visual index worker/bulk already owns lock; retry later');
    // One catalog snapshot and current-version join per run, never per batch.
    // Repair deliberately includes every ready reference, even no-longer-eligible
    // fronts. Never trust/reuse any stored digest vector during this repair.
    if (repair) {
      const other = await client.query(`SELECT count(*)::int AS count FROM catalog_visual_references
        WHERE status='ready' AND model_version<>$1`, [MODEL_VERSION]);
      if (other.rows[0].count) throw new Error('Other-model ready references require separate repair review');
    }
    const snapshot = repair ? await client.query(`SELECT reference_url AS url, status, attempts, true AS due
      FROM catalog_visual_references WHERE model_version=$1 AND status='ready' ORDER BY key`, [MODEL_VERSION])
      : await client.query(`WITH eligible AS (
      SELECT c.front_image_url AS url, min(c.id) AS first_id ${CATALOG}
      WHERE ${ELIGIBLE} GROUP BY c.front_image_url
    ) SELECT e.url, r.status, r.attempts,
      (r.key IS NULL OR (r.status='failed' AND r.attempts<5 AND r.retry_at<=now())) AS due
      FROM eligible e LEFT JOIN catalog_visual_references r
      ON r.reference_url=e.url AND r.model_version=$1 ORDER BY e.first_id`, [MODEL_VERSION]);
    const counts = {
      eligible: snapshot.rows.length,
      ready: snapshot.rows.filter(r => r.status === 'ready').length,
      deferred: snapshot.rows.filter(r => r.status === 'failed' && r.attempts < 5 && !r.due).length,
      exhausted: snapshot.rows.filter(r => r.status === 'failed' && r.attempts >= 5).length,
      due: snapshot.rows.filter(r => r.due).length,
    };
    const urls: string[] = snapshot.rows.filter(r => r.due).slice(0, limit).map(r => r.url);
    snapshot.rows.length = 0;
    log({ event: 'snapshot', model: MODEL_VERSION, ...counts, selected: urls.length,
      repair, inference: 'Exact query single-image function; sequential CPU inference, concurrent downloads',
      readOnly, batchSize, downloadConcurrency: 4,
      // Two batches of compressed images + up to four Buffer.concat copies.
      compressedBufferCapMiB: (2 * batchSize + 4) * 12, snapshotSeconds: (Date.now() - start) / 1000 });
    if (readOnly) return;
    let processed = 0, success = 0, failed = 0, reused = 0;
    let downloaded = 0, downloadFailed = 0, inferenceAttempts = 0, inferred = 0, inferenceFailed = 0;
    let next = downloadBatch(urls.slice(0, batchSize));
    for (let offset = 0; offset < urls.length && !stopped; offset += batchSize) {
      const downloads = await next;
      if (connectionError) throw connectionError;
      next = downloadBatch(stopped ? [] : urls.slice(offset + batchSize, offset + 2 * batchSize));
      const good = downloads.filter(d => d.buffer);
      downloaded += good.length;
      downloadFailed += downloads.length - good.length;
      const digests = good.map(d => visualContentDigest(d.buffer!));
      const shared = !repair && digests.length ? await client.query(`SELECT content_digest, embedding
        FROM catalog_visual_references WHERE model_version=$1 AND status='ready'
        AND content_digest=ANY($2::text[])`, [MODEL_VERSION, digests]) : { rows: [] };
      const vectors = new Map<string, number[]>(shared.rows.map(r => [r.content_digest, r.embedding]));
      for (const item of downloads) {
        const digest = item.buffer ? visualContentDigest(item.buffer) : '';
        let vector = repair ? undefined : vectors.get(digest);
        let error = item.error;
        if (vector) reused++;
        else if (item.buffer) {
          inferenceAttempts++;
          try {
            vector = await embedCatalogVisualImage(item.buffer, 'background');
            inferred++;
            if (!repair) vectors.set(digest, vector);
          } catch (failure) { error = failure; inferenceFailed++; }
        }
        if (vector) {
          // A single PostgreSQL upsert atomically replaces only derived fields
          // after inference succeeds; no catalog/image records are changed.
          await saveVisualReference(client, item.url, digest, vector);
          success++;
        } else {
          // A failed repair must not leave a suspect vector searchable/reusable.
          await failVisualReference(client, item.url, error ?? new Error('No embedding returned'));
          failed++;
        }
        processed++;
      }
      const seconds = (Date.now() - start) / 1000;
      log({ event: 'progress', repair, processed, success, failed, reused,
        downloaded, downloadFailed, inferenceAttempts, inferred, inferenceFailed, seconds,
        rate: processed / seconds, etaSeconds: (urls.length - processed) / (processed / seconds) });
    }
    await next; // Drain bounded prefetched downloads before releasing ownership.
    if (connectionError) throw connectionError;
    log({ event: 'summary', repair, processed, success, failed, reused, ...counts,
      downloaded, downloadFailed, inferenceAttempts, inferred, inferenceFailed,
      ...(repair ? { repaired: success, pendingUnsafeReady: urls.length - processed } : {}),
      remainingSelected: urls.length - processed, interrupted: stopped,
      seconds: (Date.now() - start) / 1000,
      retry: 'Failures persist with existing 5-minute exponential backoff, maximum 5 attempts; rerun to resume due references' });
    if (failed || stopped) process.exitCode = 2;
  } finally {
    try { if (locked && !connectionError) await client.query('SELECT pg_advisory_unlock($1)', [VISUAL_INDEX_LOCK]); }
    finally { client.removeListener('error', onError); client.release(connectionError); }
  }
}

try { await main(); }
catch (error) {
  log({ event: 'fatal', error: (error instanceof Error ? error.message : 'Bulk failed').replace(/https?:\/\/\S+/g, '[reference URL]') });
  process.exitCode = 1;
} finally { await pool.end(); }
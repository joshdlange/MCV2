import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';

// Deliberately independent of the application, database, model and indexing code.
const dir = path.resolve('.local/scan-review');
const source = JSON.parse(await fs.readFile(path.join(dir, 'source.json'), 'utf8'));
if (!Array.isArray(source.rows) || source.rows.length !== 72
  || new Set(source.rows.map((r: any) => r.scanId)).size !== 72) {
  throw new Error('Expected exactly 72 distinct selected scan records');
}
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const cloudinary = (u: unknown): u is string => {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && p.hostname === 'res.cloudinary.com'
      && !p.username && !p.password && !p.port;
  } catch { return false; }
};
const image = async (b: Buffer, width: number) => {
  const m = await sharp(b, { limitInputPixels: 60_000_000 }).metadata();
  if (!m.width || !m.height) throw new Error('No readable raster dimensions');
  const preview = await sharp(b, { limitInputPixels: 60_000_000 })
    .rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  return 'data:image/jpeg;base64,' + preview.toString('base64');
};
const fields = ['cardId', 'name', 'cardNumber', 'year', 'subsetName', 'subsetId',
  'mainSetName', 'mainSetId', 'variation'] as const;
function suggestion(value: any) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(fields.map(k => [k, value[k] ?? null]));
}
const groups = new Map<string, any[]>();
for (const row of source.rows) {
  const key = String(row.candidate?.mainSetId ?? row.prediction?.mainSetId ?? 'unknown');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(row);
}
// Round-robin suspected sets; these are unverified strata, not true set labels.
const ordered: any[] = [];
while ([...groups.values()].some(g => g.length)) {
  for (const g of groups.values()) if (g.length) ordered.push(g.shift());
}
await fs.mkdir(path.join(dir, 'originals'), { recursive: true });
const failures: { scanId: number; error: string }[] = [];
const duplicates: { scanId: number; matchesScanId: number; sha256: string }[] = [];
const seen = new Map<string, number>();
const rows: any[] = [];
let attempts = 0;
for (const row of ordered) {
  if (rows.length === 60 || attempts === 72) break;
  attempts++;
  try {
    if (!cloudinary(row.sourceImageUrl)) throw new Error('Original URL is not HTTPS Cloudinary');
    const bytes = await downloadCatalogReference(row.sourceImageUrl);
    const digest = hash(bytes);
    if (seen.has(digest)) {
      duplicates.push({ scanId: row.scanId, matchesScanId: seen.get(digest)!, sha256: digest });
      continue;
    }
    const preview = await image(bytes, 1200);
    const ext = (await sharp(bytes).metadata()).format;
    const file = 'originals/' + digest + '.' + (ext === 'jpeg' ? 'jpg' : ext);
    await fs.writeFile(path.join(dir, file), bytes, { flag: 'wx' }).catch(async (e: any) => {
      if (e.code !== 'EEXIST' || hash(await fs.readFile(path.join(dir, file))) !== digest) throw e;
    });
    seen.set(digest, row.scanId);
    rows.push({ scanId: row.scanId, imageHash: digest, originalPhotoFile: file,
      photo: preview, candidate: suggestion(row.candidate), prediction: suggestion(row.prediction),
      referenceUrls: [row.candidate?.imageUrl, row.prediction?.imageUrl] });
    console.log('original', attempts, rows.length, row.scanId);
  } catch (e) {
    failures.push({ scanId: row.scanId, error: e instanceof Error ? e.message : String(e) });
    console.log('failed', attempts, row.scanId, failures.at(-1)?.error);
  }
}
// Download references only for displayed rows; no relative /uploads path is fetched.
const refs = new Map<string, string | null>();
const refFailures: { url: string; error: string }[] = [];
const urls = [...new Set(rows.flatMap(r => r.referenceUrls).filter((u): u is string => typeof u === 'string'))];
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
  while (cursor < urls.length) {
    const url = urls[cursor++];
    if (!cloudinary(url)) { refs.set(url, null); continue; }
    try { refs.set(url, await image(await downloadCatalogReference(url), 700)); }
    catch (e) {
      refs.set(url, null);
      refFailures.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
}));
for (const r of rows) {
  r.references = r.referenceUrls.map((url: string | undefined) => url ? refs.get(url) ?? null : null);
  delete r.referenceUrls;
}
const datasetHash = hash(Buffer.from(JSON.stringify(rows.map(r =>
  ({ scanId: r.scanId, imageHash: r.imageHash, originalPhotoFile: r.originalPhotoFile,
    candidate: r.candidate, prediction: r.prediction })))));
const dataset = { schema: 'offline-scan-identity-review-v1', datasetHash, rows };
const json = JSON.stringify(dataset).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026').replace(/\u2028|\u2029/g, '');
const template = await fs.readFile(path.join(import.meta.dirname, 'scan-review-template.html'), 'utf8');
await fs.writeFile(path.join(dir, 'review.html'), template.replace('<!-- DATASET -->',
  '<script id="dataset" type="application/json">' + json + '</script>'));
const provenance = {
  schema: dataset.schema, datasetHash, source: '.local/scan-review/source.json',
  sourceRows: source.rows.length, originalAttemptCount: attempts, selectedDistinctPhotos: rows.length,
  duplicatePhotoCount: duplicates.length, duplicates, originalFailures: failures,
  referenceUrlCount: urls.length, referenceEmbeddedCount: [...refs.values()].filter(Boolean).length,
  referenceFailures: refFailures,
  selected: rows.map(r => ({ scanId: r.scanId, imageHash: r.imageHash, originalPhotoFile: r.originalPhotoFile })),
  cautions: [
    'All candidates and predictions are UNVERIFIED suggestions, not ground truth.',
    'Selection was stratified by UNVERIFIED suspected set; not a representative population sample.',
    'SHA256 deduplication is of original bytes only, not visually identical or same-art photos.',
    'Missing references and same-art references are not evidence of an identity.',
    'No reviews were prefilled; no inference, indexing or production data changes occurred.',
  ],
};
await fs.writeFile(path.join(dir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify({ pack: path.join(dir, 'review.html'), datasetHash,
  attempts, selected: rows.length, duplicates: duplicates.length, failures: failures.length,
  referenceFailures: refFailures.length, bytes: (await fs.stat(path.join(dir, 'review.html'))).size }));
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from 'express';

export const REVIEW_DIR = process.env.NODE_ENV === 'test' && process.env.SCAN_REVIEW_TEST_DIR
  ? path.resolve(process.env.SCAN_REVIEW_TEST_DIR) : path.resolve(process.cwd(), '.local/scan-review');
const REVIEW_FILE = path.join(REVIEW_DIR, 'decisions.json');
const HTML_FILE = path.join(REVIEW_DIR, 'review.html');
type Suggestion = { cardId: number; name: string; year: number | null; mainSetName: string | null; subsetName: string | null; cardNumber: string | null };
type SourceRow = {
  scanId: number; imageHash: string; originalPhotoFile: string;
  candidate: Suggestion | null; prediction: Suggestion | null; references: (string | null)[];
};
export type ReviewDecision = { status: 'confirmed' | 'unresolved' | 'skipped'; cardId: number | null; note: string; reviewerId: number; reviewedAt: string };
type Dataset = { datasetHash: string; rows: SourceRow[] };
type ScanMetadataRow = { scanId: number; ocr: string | null; vision: unknown; topCardId: number | null;
  confidence?: string | number | null;
  candidates: Array<Suggestion & { imageUrl?: string | null; setName?: string | null; confidence?: number;
    confidenceLevel?: string; similarity?: number; matchReasons?: string[] }> };
type DecisionFile = { datasetHash: string; decisions: Record<string, ReviewDecision> };
export class ReviewError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const requireDevelopmentAdmin: RequestHandler = (req: any, res, next) => {
  if (process.env.NODE_ENV !== 'development')
    return res.status(404).json({ message: 'Development-only review is unavailable' });
  if (!req.user?.isAdmin)
    return res.status(403).json({ message: 'Admin access required' });
  next();
};
let datasetPromise: Promise<Dataset> | undefined;
let writes: Promise<unknown> = Promise.resolve();
export async function atomicReviewJson(filename: string, value: unknown) {
  const temporary = path.join(REVIEW_DIR, `${filename}.${process.pid}.${createHash('sha256').update(String(Math.random())).digest('hex')}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await fs.rename(temporary, path.join(REVIEW_DIR, filename));
    const dir = await fs.open(REVIEW_DIR, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (e) { await fs.unlink(temporary).catch(() => {}); throw e; }
}
export async function saveScanBenchmark(datasetHash: string, benchmark: unknown) {
  await atomicReviewJson('benchmark.json', { datasetHash, benchmark });
}
export async function readScanBenchmark(datasetHash: string): Promise<any | null> {
  try {
    const file = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'benchmark.json'), 'utf8'));
    if (file.datasetHash !== datasetHash || !file.benchmark || file.benchmark.results?.datasetHash !== datasetHash)
      throw new Error('Saved scan benchmark does not match the review dataset');
    if (file.benchmark.status === 'running') {
      return { ...file.benchmark, status: 'failed',
        error: 'Benchmark interrupted by server restart; rerun against confirmed labels.' };
    }
    return file.benchmark;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function loadScanReviewDataset(): Promise<Dataset> {
  if (!datasetPromise) datasetPromise = (async () => {
    const html = await fs.readFile(HTML_FILE, 'utf8');
    const match = html.match(/<script id="dataset" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Saved scan review dataset is missing');
    const data = JSON.parse(match[1]) as Dataset;
    const provenance = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'provenance.json'), 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(data.datasetHash) || data.datasetHash !== provenance.datasetHash
        || data.rows.length !== 60 || provenance.selectedDistinctPhotos !== 60
        || data.rows.some((row, index) => row.scanId !== provenance.selected[index]?.scanId
          || row.imageHash !== provenance.selected[index]?.imageHash
          || !/^originals\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(row.originalPhotoFile)
          || !row.originalPhotoFile.includes(row.imageHash))) {
      throw new Error('Saved scan review dataset does not match the 60 prepared originals');
    }
    return data;
  })().catch(e => { datasetPromise = undefined; throw e; });
  return datasetPromise;
}
let metadataPromise: Promise<Map<number, ScanMetadataRow>> | undefined;
export async function loadScanMetadata(): Promise<Map<number, ScanMetadataRow>> {
  if (!metadataPromise) metadataPromise = (async () => {
    const dataset = await loadScanReviewDataset();
    const file = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'scan-metadata.json'), 'utf8'));
    if (!Array.isArray(file.rows) || file.rows.length !== 60 ||
        new Set(file.rows.map((row: ScanMetadataRow) => row.scanId)).size !== 60 ||
        file.rows.some((row: ScanMetadataRow) => !dataset.rows.some(original => original.scanId === row.scanId)
          || !Array.isArray(row.candidates))) {
      throw new Error('Saved scan metadata does not match the selected 60 scans');
    }
    return new Map<number, ScanMetadataRow>(file.rows.map((row: ScanMetadataRow) => [row.scanId, row]));
  })().catch(e => { metadataPromise = undefined; throw e; });
  return metadataPromise;
}
export async function originalScanBytes(row: SourceRow): Promise<Buffer> {
  const bytes = await fs.readFile(path.join(REVIEW_DIR, row.originalPhotoFile));
  if (createHash('sha256').update(bytes).digest('hex') !== row.imageHash)
    throw new Error(`Original scan ${row.scanId} failed integrity check`);
  return bytes;
}
export function referenceBytes(row: SourceRow, index: number): Buffer | null {
  const data = row.references[index];
  if (!data || !/^data:image\/jpeg;base64,/.test(data)) return null;
  return Buffer.from(data.slice('data:image/jpeg;base64,'.length), 'base64');
}
async function readDecisions(datasetHash: string): Promise<DecisionFile> {
  try {
    const file = JSON.parse(await fs.readFile(REVIEW_FILE, 'utf8'));
    if (file.datasetHash !== datasetHash || !file.decisions || typeof file.decisions !== 'object'
        || Array.isArray(file.decisions)) throw new Error('Review decisions dataset mismatch or malformed');
    return file;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { datasetHash, decisions: {} };
    throw e;
  }
}
export async function scanReviewState() {
  await writes;
  const dataset = await loadScanReviewDataset();
  const { decisions } = await readDecisions(dataset.datasetHash);
  return { dataset, decisions };
}
export function reviewProgress(decisions: Record<string, ReviewDecision>, total = 60) {
  const confirmed = Object.values(decisions).filter(d => d.status === 'confirmed').length;
  const unresolved = Object.values(decisions).filter(d => d.status === 'unresolved').length;
  const skipped = Object.values(decisions).filter(d => d.status === 'skipped').length;
  const reviewed = confirmed + unresolved;
  return { total, reviewed, confirmed, unresolved, skipped, remaining: total - reviewed - skipped,
    percent: Math.round(reviewed / total * 100) };
}
export function approvedLabels(rows: SourceRow[], decisions: Record<string, ReviewDecision>) {
  return rows.filter(row => decisions[row.scanId]?.status === 'confirmed'
    && Number.isSafeInteger(decisions[row.scanId].cardId) && (decisions[row.scanId].cardId ?? 0) > 0)
    .map(row => ({ row, cardId: decisions[row.scanId].cardId! }));
}
export function requireBenchmarkLabels(rows: SourceRow[], decisions: Record<string, ReviewDecision>) {
  const labels = approvedLabels(rows, decisions);
  if (labels.length < 50) throw new ReviewError(`At least 50 confirmed labels are required (${labels.length}/50)`, 409);
  return labels;
}
export function allLabeledCardsExist(cardIds: number[], existing: ReadonlySet<number>): boolean {
  return [...new Set(cardIds)].every(id => existing.has(id));
}
export async function saveScanDecision(scanId: number, body: unknown, reviewerId: number,
  cardExists: (cardId: number) => Promise<boolean>) {
  const task = writes.then(async () => {
    const dataset = await loadScanReviewDataset();
    if (!dataset.rows.some(row => row.scanId === scanId)) throw new ReviewError('Unknown scan ID', 404);
    const input = body as Record<string, unknown>;
    if (!input || input.datasetHash !== dataset.datasetHash) throw new ReviewError('Dataset hash mismatch', 409);
    if (input.status !== 'confirmed' && input.status !== 'unresolved' && input.status !== 'skipped')
      throw new ReviewError('Invalid review status', 400);
    const note = input.note === undefined ? '' : input.note;
    if (typeof note !== 'string' || note.length > 500) throw new ReviewError('Note must be at most 500 characters', 400);
    const cardId = input.status === 'confirmed' ? input.cardId : null;
    if (input.status !== 'confirmed' && input.cardId != null)
      throw new ReviewError('Unresolved or skipped scans cannot have a card ID', 400);
    if (input.status === 'confirmed' && (!Number.isSafeInteger(cardId) || (cardId as number) <= 0
      || !await cardExists(cardId as number))) throw new ReviewError('Selected card does not exist in the catalog', 400);
    const file = await readDecisions(dataset.datasetHash);
    file.decisions[scanId] = {
      status: input.status, cardId: cardId as number | null, note: note.trim(),
      reviewerId, reviewedAt: new Date().toISOString(),
    };
    await atomicReviewJson('decisions.json', file);
  });
  writes = task.catch(() => {});
  await task;
}
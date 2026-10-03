import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { devDataPath } from '../devData';
import { suppressAutomaticCatalogMutations } from '../devCatalogSnapshot';
import {
  MODEL_VERSION, VECTOR_DIMENSIONS, embedCatalogVisualImage, preloadBundledCatalogVisualModel,
} from './catalogVisualModel';
import { scanFamilyKey, type ScanCandidateRow, type ScoredMatch } from './scanMatching';

export const isDevScanVisualEnabled = suppressAutomaticCatalogMutations;
export interface DevScanCatalogCard extends ScanCandidateRow { active: boolean; setId?: number; mainSetId?: number | null }
export interface DevScanFrozenIndex {
  model: string;
  indexed: number;
  manifestCount: number;
  missing: number;
  rows: { k: number; cardIds: number[] }[];
}
export interface DevScanVisualFamily {
  familyKey: string;
  score: number;
  representativeCardId: number;
  options: ScoredMatch[];
}
export interface DevScanVisualResult {
  matches: ScoredMatch[];
  families: DevScanVisualFamily[];
  /** Raw max-dot ranking heuristics, not calibrated probabilities. */
  topScore: number | null;
  /** Difference between the best two distinct families; null if fewer than two. */
  margin: number | null;
  rankedCardIds?: number[];
  browseHint?: { year: number | null; mainSetId: number | null; setId: number; setName: string };
  timings: { queueMs: number; cropMs: number; embeddingMs: number; searchMs: number; totalMs: number };
}
type Embed = (buffer: Buffer) => Promise<number[]>;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function validateDevScanIndex(index: DevScanFrozenIndex, matrix: Float32Array): void {
  if (index.model !== MODEL_VERSION) throw new Error('Frozen visual index model mismatch');
  if (!Array.isArray(index.rows) || !index.rows.length || index.indexed !== index.rows.length
      || !Number.isSafeInteger(index.manifestCount) || !Number.isSafeInteger(index.missing)
      || index.missing < 0 || index.manifestCount !== index.indexed + index.missing
      || matrix.length !== index.rows.length * VECTOR_DIMENSIONS) {
    throw new Error('Frozen visual index length/count mismatch');
  }
  const ids = new Set<number>();
  for (const [i, row] of index.rows.entries()) {
    // k is the source-manifest ordinal, NOT the packed matrix row; missing
    // downloads leave gaps. Matrix offsets always use the array ordinal i.
    if (!Number.isSafeInteger(row.k) || row.k < 0 || row.k >= index.manifestCount
        || (i > 0 && row.k <= index.rows[i - 1].k)
        || !Array.isArray(row.cardIds) || !row.cardIds.length) {
      throw new Error(`Invalid frozen visual index row ${i}`);
    }
    for (const id of row.cardIds) {
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) {
        throw new Error(`Invalid or duplicate frozen visual card ID ${id}`);
      }
      ids.add(id);
    }
    let norm = 0;
    for (let d = 0; d < VECTOR_DIMENSIONS; d++) {
      const value = matrix[i * VECTOR_DIMENSIONS + d];
      if (!Number.isFinite(value)) throw new Error(`Non-finite frozen visual vector at row ${i}`);
      norm += value * value;
    }
    if (Math.abs(Math.sqrt(norm) - 1) > 0.001) throw new Error(`Invalid frozen visual vector norm at row ${i}`);
  }
}

/** Reads only the frozen current arm. Never rebuilds or writes anything. */
export async function loadDevScanFrozenIndex(directory = devDataPath('phase-c0', 'index-prod')) {
  const [json, bytes] = await Promise.all([
    fs.readFile(path.join(directory, 'index.json')), fs.readFile(path.join(directory, 'current.f32')),
  ]);
  if (bytes.byteLength % 4) throw new Error('Frozen visual index invalid float32 byte length');
  const index: DevScanFrozenIndex = JSON.parse(json.toString('utf8'));
  // Copy guarantees float32 alignment regardless of the Node Buffer allocator.
  const matrix = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  validateDevScanIndex(index, matrix);
  let verifyBytes: Buffer | undefined;
  try { verifyBytes = await fs.readFile(path.join(directory, 'verify.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (verifyBytes) {
    const verify = JSON.parse(verifyBytes.toString('utf8'));
    if (verify.currentSha256 !== sha256(bytes) || verify.indexJsonSha256 !== sha256(json)
        || verify.rows !== index.rows.length || verify.manifestCount !== index.manifestCount
        || verify.missing !== index.missing || verify.badNorm !== 0) {
      throw new Error('Frozen visual index verification/checksum mismatch');
    }
  }
  return { index, matrix };
}

/** C0 arm C verbatim rounding/encoding; only EXIF orientation, never inferred rotation. */
export async function devScanCenterCrop(buffer: Buffer, fraction: number): Promise<Buffer> {
  const img = sharp(await sharp(buffer, { limitInputPixels: 24_000_000 }).rotate().toBuffer());
  const { width = 0, height = 0 } = await img.metadata();
  const w = Math.round(width * fraction), h = Math.round(height * fraction);
  return img.extract({
    left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h,
  }).toBuffer();
}

/** Preserve C0's Float32 score storage (including tie behavior), not just its dot formula. */
export function scoreDevScanRows(vectors: number[][], matrix: Float32Array, count: number): Float32Array {
  if (!vectors.length || matrix.length !== count * VECTOR_DIMENSIONS) throw new Error('Invalid visual scoring input');
  for (const vector of vectors) {
    if (vector.length !== VECTOR_DIMENSIONS || vector.some(value => !Number.isFinite(value))) {
      throw new Error('Invalid visual query vector');
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (Math.abs(norm - 1) > 0.001) throw new Error('Invalid visual query vector norm');
  }
  const scores = new Float32Array(count).fill(-Infinity);
  for (const q of vectors) for (let r = 0; r < count; r++) {
    let dot = 0; const o = r * VECTOR_DIMENSIONS;
    for (let d = 0; d < VECTOR_DIMENSIONS; d++) dot += q[d] * matrix[o + d];
    if (dot > scores[r]) scores[r] = dot;
  }
  return scores;
}

export class DevScanVisualService {
  private readonly cards = new Map<number, DevScanCatalogCard>();
  private readonly familyById = new Map<number, string>();
  private readonly optionsByFamily = new Map<string, DevScanCatalogCard[]>();
  private readonly activeIdsByRow: number[][];
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly index: DevScanFrozenIndex,
    private readonly matrix: Float32Array,
    catalog: DevScanCatalogCard[],
    private readonly embed: Embed = buffer => embedCatalogVisualImage(buffer, 'scan', { offline: true }),
    private readonly maxWaiting = 4,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    if (!isDevScanVisualEnabled(env)) throw new Error('Development visual retrieval is disabled');
    if (!Number.isSafeInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 16) throw new Error('Invalid visual queue bound');
    validateDevScanIndex(index, matrix);
    for (const row of catalog) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || this.cards.has(row.id)) {
        throw new Error(`Invalid or duplicate DEV catalog card ID ${row.id}`);
      }
      const card = Object.freeze({ ...row });
      this.cards.set(card.id, card);
      if (!card.active) continue;
      const key = scanFamilyKey(card);
      this.familyById.set(card.id, key);
      const options = this.optionsByFamily.get(key) ?? [];
      options.push(card);
      this.optionsByFamily.set(key, options);
    }
    for (const options of this.optionsByFamily.values()) options.sort((a, b) => a.id - b.id);
    this.activeIdsByRow = index.rows.map(row => row.cardIds.filter(id => {
      if (!this.cards.has(id)) throw new Error(`Frozen index card ${id} missing from DEV catalog`);
      return this.cards.get(id)!.active;
    }));
    if (!this.activeIdsByRow.some(ids => ids.length)) throw new Error('Frozen index has no active DEV catalog cards');
  }

  /** One active whole 3-crop request plus at most maxWaiting queued requests.
   * No disk, database, OCR, network, image upload, or photo retention on this path.
   */
  scan(buffer: Buffer): Promise<DevScanVisualResult> {
    if (!isDevScanVisualEnabled(this.env)) return Promise.reject(new Error('Development visual retrieval is disabled'));
    if (!buffer.length || buffer.length > 12 * 1024 * 1024) return Promise.reject(new Error('Visual image must be 1 byte–12 MB'));
    if (this.pending >= this.maxWaiting + 1) return Promise.reject(new Error('Development visual retrieval busy; retry shortly'));
    const started = performance.now();
    this.pending++;
    const work = this.tail.then(async () => {
      const ready = performance.now();
      const crops = [buffer, await devScanCenterCrop(buffer, 0.85), await devScanCenterCrop(buffer, 0.7)];
      const cropped = performance.now();
      const vectors: number[][] = [];
      // Sequential calls avoid filling the shared per-image inference scheduler.
      for (const crop of crops) vectors.push(await this.embed(crop));
      const embedded = performance.now();
      const ranked = this.rankVectors(vectors);
      const finished = performance.now();
      return {
        ...ranked,
        timings: {
          queueMs: ready - started, cropMs: cropped - ready, embeddingMs: embedded - cropped,
          searchMs: finished - embedded, totalMs: finished - started,
        },
      };
    });
    const settled = work.finally(() => { this.pending--; });
    this.tail = settled.catch(() => undefined);
    return settled;
  }

  /** Also permits deterministic offline parity tests with injected embeddings. */
  rankVectors(vectors: number[][]): Omit<DevScanVisualResult, 'timings'> {
    if (!isDevScanVisualEnabled(this.env)) throw new Error('Development visual retrieval is disabled');
    const scores = scoreDevScanRows(vectors, this.matrix, this.index.rows.length);
    const direct = new Map<number, number>();
    const bestByFamily = new Map<string, { score: number; id: number }>();
    this.activeIdsByRow.forEach((ids, r) => {
      for (const id of ids) {
        const score = scores[r], key = this.familyById.get(id)!;
        direct.set(id, score);
        const best = bestByFamily.get(key);
        if (!best || score > best.score || (score === best.score && id < best.id)) bestByFamily.set(key, { score, id });
      }
    });
    const rankedCardIds = [...direct.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
    const votes = new Map<number, { count: number; card: DevScanCatalogCard }>();
    for (const id of rankedCardIds.slice(0, 10)) {
      const card = this.cards.get(id)!;
      const key = card.mainSetId ?? card.setId;
      if (key === undefined) continue;
      const prior = votes.get(key);
      votes.set(key, { count: (prior?.count ?? 0) + 1, card: prior?.card ?? card });
    }
    const hinted = [...votes.values()].sort((a, b) => b.count - a.count)[0]?.card;
    const families = [...bestByFamily.entries()]
      .sort((a, b) => b[1].score - a[1].score || a[1].id - b[1].id)
      .slice(0, 5).map(([familyKey, best]): DevScanVisualFamily => {
        const options = this.optionsByFamily.get(familyKey)!.map((row): ScoredMatch => {
          const similarity = direct.get(row.id);
          return {
            cardId: row.id, name: row.name, cardNumber: row.cardNumber, setName: row.setName,
            subsetName: row.variation || (row.isInsertSubset ? row.setName : null),
            year: row.setYear, imageUrl: row.frontImageUrl,
            confidence: (similarity ?? best.score) * 100,
            confidenceLevel: (similarity ?? best.score) >= 0.65 ? 'medium' : 'low',
            imageSimilarity: similarity ?? best.score, familyKey,
            retrievalSource: similarity === undefined ? 'image-family' : 'image',
            matchReasons: [similarity === undefined
              ? 'Checklist-family alternative; artwork alone cannot resolve the variant'
              : 'Retrieved by catalog image similarity'],
          };
        }).sort((a, b) => b.imageSimilarity! - a.imageSimilarity! || a.cardId - b.cardId);
        return { familyKey, score: best.score, representativeCardId: best.id, options };
      });
    return {
      families, matches: families.flatMap(family => family.options),
      rankedCardIds: rankedCardIds.slice(0, 100),
      browseHint: hinted?.setId ? { year: hinted.setYear, mainSetId: hinted.mainSetId ?? null, setId: hinted.setId, setName: hinted.mainSetName || hinted.setName } : undefined,
      topScore: families[0]?.score ?? null,
      margin: families.length > 1 ? families[0].score - families[1].score : null,
    };
  }
}

let startup: Promise<DevScanVisualService> | undefined;
let service: DevScanVisualService | undefined;
export function getDevScanVisualService(): DevScanVisualService {
  if (!isDevScanVisualEnabled()) throw new Error('Development visual retrieval is disabled');
  if (!service) throw new Error('Development visual retrieval not initialized at startup');
  return service;
}

/** Exactly one DEV catalog read at startup, including no-image parallels.
 * The strict guard executes before any model/file/DB work.
 */
export async function initializeDevScanVisual(): Promise<DevScanVisualService | undefined> {
  if (!isDevScanVisualEnabled()) return undefined;
  startup ??= (async () => {
    const { db } = await import('../db');
    const { cards, cardSets, mainSets } = await import('../../shared/schema');
    const { eq, and, or, isNull } = await import('drizzle-orm');
    const { index, matrix } = await loadDevScanFrozenIndex();
    const catalog = await db.select({
      id: cards.id, name: cards.name, cardNumber: cards.cardNumber, setId: cards.setId, mainSetId: cardSets.mainSetId,
      frontImageUrl: cards.frontImageUrl, variation: cards.variation, isInsert: cards.isInsert,
      setName: cardSets.name, setYear: cardSets.year, mainSetName: mainSets.name,
      isInsertSubset: cardSets.isInsertSubset,
      active: and(isNull(cards.archivedAt), isNull(cardSets.archivedAt), eq(cardSets.isActive, true),
        or(isNull(mainSets.id), and(isNull(mainSets.archivedAt), eq(mainSets.isActive, true))))!,
    }).from(cards).innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id));
    const next = new DevScanVisualService(index, matrix, catalog as DevScanCatalogCard[]);
    await preloadBundledCatalogVisualModel();
    service = next;
    return next;
  })();
  return startup;
}
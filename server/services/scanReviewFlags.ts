import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicReviewJson, REVIEW_DIR, ReviewError } from './scanReview';

export const IMAGE_ISSUE_TYPES = [
  'wrong-card-image', 'wrong-parallel-image', 'front-back-swapped',
  'poor-crop', 'missing-image', 'low-quality', 'other',
] as const;
export type ImageIssue = {
  scanId: number; cardId: number; type: typeof IMAGE_ISSUE_TYPES[number];
  note: string; reviewerId: number; reportedAt: string;
};
type FlagFile = {
  datasetHash: string;
  issues: Record<string, ImageIssue>;
  searchBlocked: Record<string, { blocked: boolean; note: string; reviewerId: number; reportedAt: string }>;
};
let writes: Promise<unknown> = Promise.resolve();
async function readFlagsUnchecked(datasetHash: string): Promise<FlagFile> {
  try {
    const file = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'flags.json'), 'utf8'));
    if (file.datasetHash !== datasetHash || !file.issues || !file.searchBlocked)
      throw new Error('Scan review flags do not match selected dataset');
    return file;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { datasetHash, issues: {}, searchBlocked: {} };
    throw e;
  }
}
export async function readReviewFlags(datasetHash: string): Promise<FlagFile> {
  await writes;
  return readFlagsUnchecked(datasetHash);
}
function validateHash(datasetHash: string, body: any) {
  if (!body || body.datasetHash !== datasetHash) throw new ReviewError('Dataset hash mismatch', 409);
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500))
    throw new ReviewError('Note must be at most 500 characters', 400);
}
export async function updateReviewFlags(datasetHash: string, body: any,
  reviewerId: number, change: { scanId: number; cardId?: number; remove?: boolean }) {
  const task = writes.then(async () => {
    validateHash(datasetHash, body);
    const file = await readFlagsUnchecked(datasetHash);
    const { scanId, cardId } = change;
    const note = (body.note ?? '').trim();
    if (cardId !== undefined) {
      const key = `${scanId}:${cardId}`;
      if (change.remove) delete file.issues[key];
      else {
        if (!IMAGE_ISSUE_TYPES.includes(body.type)) throw new ReviewError('Invalid image issue type', 400);
        file.issues[key] = { scanId, cardId, type: body.type, note,
          reviewerId, reportedAt: new Date().toISOString() };
      }
    } else {
      if (typeof body.blocked !== 'boolean') throw new ReviewError('blocked must be a boolean', 400);
      file.searchBlocked[scanId] = { blocked: body.blocked, note,
        reviewerId, reportedAt: new Date().toISOString() };
    }
    await atomicReviewJson('flags.json', file);
  });
  writes = task.catch(() => {});
  await task;
}
// Historical notes are evidence of a reported problem, not a retroactive edit
// to the independent identity decision or a verified issue classification.
export function legacyReviewEvidence(decision: { note?: string; status?: string } | null) {
  const note = decision?.note ?? '';
  return {
    suspectedSearchBlocked: decision?.status === 'unresolved' &&
      /search|find the right|search restraints/i.test(note),
    reviewerReportedImageIssue: decision?.status === 'confirmed' &&
      /\bwrong image\b/i.test(note),
  };
}
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicReviewJson, REVIEW_DIR, ReviewError } from './scanReview';

export const SIDES = ['front', 'back', 'uncertain'] as const;
export const OCR_TAGS = ['empty', 'weak', 'contradictory', 'useful'] as const;
export const UNRESOLVED_REASONS = [
  'cannot identify exact card',
  'search tool could not find card',
  'only back image available',
  'bad/missing catalog image',
  'duplicate/archived catalog ambiguity',
  'insufficient image quality',
  'other',
] as const;
export type Classification = {
  side?: typeof SIDES[number];
  ocrTag?: typeof OCR_TAGS[number];
  unresolvedReason?: typeof UNRESOLVED_REASONS[number] | null;
  metadataParsing?: { status: 'unreviewed' | 'supported' | 'contradictory'; reason: string };
  note?: string; reviewerId: number; classifiedAt: string;
};
type ClassificationFile = { datasetHash: string; classifications: Record<string, Classification> };
let writes: Promise<unknown> = Promise.resolve();
async function readUnchecked(datasetHash: string): Promise<ClassificationFile> {
  try {
    const file = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'classifications.json'), 'utf8'));
    if (file.datasetHash !== datasetHash || !file.classifications || Array.isArray(file.classifications))
      throw new Error('Review classifications dataset mismatch');
    return file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { datasetHash, classifications: {} };
    throw error;
  }
}
export async function readReviewClassifications(datasetHash: string) {
  await writes;
  return readUnchecked(datasetHash);
}
export async function saveReviewClassification(datasetHash: string, scanId: number,
  body: any, reviewerId: number, decisionStatus: string | null) {
  const task = writes.then(async () => {
    if (!body || body.datasetHash !== datasetHash) throw new ReviewError('Dataset hash mismatch', 409);
    if (body.side !== undefined && !SIDES.includes(body.side))
      throw new ReviewError('Invalid scan side', 400);
    if (body.ocrTag !== undefined && !OCR_TAGS.includes(body.ocrTag))
      throw new ReviewError('Invalid OCR tag', 400);
    if (body.unresolvedReason !== undefined) {
      if (decisionStatus !== 'unresolved')
        throw new ReviewError('An unresolved reason requires an unresolved review', 400);
      if (body.unresolvedReason !== null && !UNRESOLVED_REASONS.includes(body.unresolvedReason))
        throw new ReviewError('Invalid unresolved reason', 400);
    }
    if (body.metadataParsing !== undefined) {
      const parsing = body.metadataParsing;
      if (!parsing || !['unreviewed', 'supported', 'contradictory'].includes(parsing.status) ||
        typeof parsing.reason !== 'string' || parsing.reason.length > 500 ||
        (parsing.status !== 'unreviewed' && !parsing.reason.trim()))
        throw new ReviewError('Metadata parsing status and evidence reason are required', 400);
    }
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500))
      throw new ReviewError('Note must be at most 500 characters', 400);
    const file = await readUnchecked(datasetHash);
    const previous = file.classifications[scanId] ?? { reviewerId, classifiedAt: new Date().toISOString() };
    file.classifications[scanId] = {
      ...previous,
      ...(body.side === undefined ? {} : { side: body.side }),
      ...(body.ocrTag === undefined ? {} : { ocrTag: body.ocrTag }),
      ...(body.unresolvedReason === undefined ? {} : { unresolvedReason: body.unresolvedReason }),
      ...(body.metadataParsing === undefined ? {} : { metadataParsing: {
        status: body.metadataParsing.status, reason: body.metadataParsing.reason.trim(),
      } }),
      ...(body.note === undefined ? {} : { note: body.note.trim() }),
      reviewerId, classifiedAt: new Date().toISOString(),
    };
    await atomicReviewJson('classifications.json', file);
  });
  writes = task.catch(() => {});
  await task;
}

export function effectiveClassification(scanId: number, decision: { status: string; note?: string } | null,
  saved: Classification | undefined, ocr: string | null) {
  const backFromReviewerNote = scanId === 3084 && decision?.note &&
    /\bback of a card\b/i.test(decision.note);
  const cleanedOcr = sanitizeOcr(ocr);
  return {
    side: saved?.side ?? (backFromReviewerNote ? 'back' : 'uncertain'),
    sideEvidence: saved?.side ? 'admin-classification'
      : backFromReviewerNote ? 'reviewer-note-3084' : 'unknown-default-uncertain',
    ocrTag: saved?.ocrTag ?? (cleanedOcr ? 'weak' : 'empty'),
    ocrEvidence: saved?.ocrTag ? 'admin-classification'
      : cleanedOcr ? 'unknown-default-weak' : 'derived-empty-after-null-removal',
    unresolvedReason: decision?.status === 'unresolved' ? saved?.unresolvedReason ?? null : null,
    metadataParsing: saved?.metadataParsing ?? { status: 'unreviewed', reason: '' },
    note: saved?.note ?? '',
    reviewerId: saved?.reviewerId ?? null, classifiedAt: saved?.classifiedAt ?? null,
  };
}
export const isMissingToken = (value: unknown): boolean =>
  value === null || value === undefined || typeof value === 'string' &&
    (!value.trim() || /^(null|undefined|none)$/i.test(value.trim()));

export function sanitizeOcr(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split(/\s+/).filter(token => !isMissingToken(token))
    .join(' ').trim();
}
export function sanitizeVision(value: unknown): unknown {
  if (isMissingToken(value)) return null;
  if (Array.isArray(value)) return value.map(sanitizeVision).filter(item => item !== null);
  if (typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, sanitizeVision(item)] as const)
      .filter(([, item]) => item !== null && (!Array.isArray(item) || item.length > 0)),
  );
  return value;
}
export async function cardNumberEvidence(ocr: unknown, vision: unknown,
  catalogSupports: (number: string, year: number | null, setHint: string | null) => Promise<boolean>) {
  const rawVision = vision && typeof vision === 'object' ? vision as Record<string, unknown> : {};
  const raw = [rawVision.normalizedCardNumber, rawVision.cardNumber]
    .find(value => typeof value === 'string' && !isMissingToken(value));
  if (typeof raw !== 'string') return { raw: null, validatedCardNumber: null,
    status: 'missing', reason: 'No extracted number; do not constrain matching.' };
  const number = raw.trim();
  const text = sanitizeOcr(ocr);
  const yearValue = rawVision.year;
  const year = typeof yearValue === 'string' && /^\d{4}$/.test(yearValue)
    ? Number(yearValue) : typeof yearValue === 'number' && Number.isInteger(yearValue) ? yearValue : null;
  const setHint = typeof rawVision.setName === 'string' && !isMissingToken(rawVision.setName)
    ? rawVision.setName : null;
  if (!/^[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8}){0,3}$/i.test(number) || number.length > 24)
    return { raw: number, validatedCardNumber: null, status: 'rejected',
      reason: 'Implausible card-number format; never use as a hard constraint.' };
  const artistPattern = /^([A-Z]{3,})-(\d{2,4})$/i.exec(number);
  const ocrLines = typeof ocr === 'string' ? ocr.toUpperCase().split(/\r?\n/) : [];
  const artistLine = artistPattern && ocrLines.some((line, index) =>
    new RegExp(`\\b[A-Z]{2,}\\s+${artistPattern[1]}\\b`, 'i').test(line)
      && ocrLines.slice(index, index + 2).some(next => new RegExp(`\\b${artistPattern[2]}\\b`).test(next)));
  const catalogMatch = await catalogSupports(number, year, setHint);
  if (artistLine && !catalogMatch)
    return { raw: number, validatedCardNumber: null, status: 'rejected',
      reason: 'Artist surname plus year-like number inferred without matching catalog number (scan 3088 pattern).' };
  if (catalogMatch)
    return { raw: number, validatedCardNumber: number, status: 'supported',
      reason: 'Exact number exists in catalog for extracted year/set context; historical parse still requires review.' };
  const marker = new RegExp(`(?:#|\\bNO\\.?\\s*)${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (marker.test(text))
    return { raw: number, validatedCardNumber: number, status: 'supported',
      reason: 'Explicit number marker visible in OCR; catalog identity is not established.' };
  return { raw: number, validatedCardNumber: null, status: 'weak',
    reason: 'No explicit number marker or plausible catalog record; never use as a hard constraint.' };
}

// Engineering regression examples are NEVER designated as an untouched holdout.
export const REVIEW_DEVELOPMENT_CASES: Record<number, string> = {
  3080: 'strict 1993 search year',
  3081: 'reviewer refers to previous year-search complaint; reason remains unverified',
  3082: 'OCR literal-null keyword',
  3084: 'reviewer-identified back photo',
  3088: 'artist name misparsed as card number',
  3094: 'empty OCR image-only example',
  3120: 'vision literal-null fields and keyword',
  3122: 'reviewer-reported search restriction',
  3123: 'reviewer-reported search/year restriction',
  3125: 'reviewer-reported year-character search restriction',
  3129: 'archived 198 versus active 17202 ambiguity; do not infer equivalence',
  3130: 'reviewer-reported wrong catalog reference',
};
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicReviewJson, REVIEW_DIR, ReviewError } from './scanReview';

type Feedback = { id: number; type: string; selectedCardId: number | null;
  createdAt: string; sameUser: boolean };
export type HistoricalRow = {
  scanId: number; createdAt: string; imageUrl: string; topCardId: number | null;
  feedback: Feedback[];
};
export type HistoricalEvidence = {
  scanId: number; createdAt: string; originalImageUrl: string; topCardId: number | null;
  candidateHistoricalCardId: number | null;
  feedbackIds: number[]; feedbackTypes: string[]; feedbackCreatedAt: string[];
  sourceStatus: 'explicit-confirmation' | 'ambiguous' | 'no-confirmation';
  sourceReason: string;
};
type Dataset = { datasetHash: string; rows: { scanId: number; imageHash: string }[] };
const sourceFile = path.join(REVIEW_DIR, 'historical-confirmations-source.json');
const reportFile = path.join(REVIEW_DIR, 'historical-labels-report.json');
let writes: Promise<unknown> = Promise.resolve();
const validId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

export function historicalEvidence(row: HistoricalRow): HistoricalEvidence {
  const feedback = row.feedback;
  const valid = feedback.filter(item => validId(item.selectedCardId) && item.sameUser &&
    ['correct', 'wrong', 'not_found'].includes(item.type) &&
    typeof item.createdAt === 'string' && item.createdAt >= row.createdAt);
  const unique = [...new Set(valid.map(item => item.selectedCardId!))];
  const ambiguous = unique.length > 1 || feedback.some(item => !item.sameUser ||
    !validId(item.id) || !['correct', 'wrong', 'not_found'].includes(item.type) ||
    typeof item.createdAt !== 'string' || item.createdAt < row.createdAt) ||
    (unique.length === 1 && feedback.some(item =>
      item.selectedCardId !== null && item.selectedCardId !== unique[0])) ||
    (unique.length === 1 && feedback.some((item, index) =>
      item.selectedCardId === null && feedback.slice(0, index).some(earlier =>
        earlier.selectedCardId === unique[0])));
  const confirmed = !ambiguous && unique.length === 1;
  return {
    scanId: row.scanId, createdAt: row.createdAt, originalImageUrl: row.imageUrl,
    topCardId: row.topCardId, candidateHistoricalCardId: confirmed ? unique[0] : null,
    feedbackIds: feedback.map(item => item.id),
    feedbackTypes: feedback.map(item => item.type),
    feedbackCreatedAt: feedback.map(item => item.createdAt),
    sourceStatus: ambiguous ? 'ambiguous' : confirmed ? 'explicit-confirmation' : 'no-confirmation',
    sourceReason: ambiguous ? 'Conflicting or invalid scan-linked collector feedback; no automatic label.'
      : confirmed ? 'Same-collector, scan-linked feedback selected_card_id: Scan to Add confirm button records the chosen ID before collection save. Feedback type only compares the old first match; top_match_card_id is not a collector label.'
        : 'No scan-linked collector-selected card ID; null feedback and top_match_card_id do not establish final identity.',
  };
}

// This local report is a PRIVATE copy of a bounded read-only production extract.
// Neither an ownership event nor a successful collection add is asserted: there
// is no scan_upload_id foreign key on user_collections, and feedback is sent
// BEFORE the asynchronous add-to-collection request succeeds or fails.
export async function loadHistoricalEvidence(dataset: Dataset): Promise<Map<number, HistoricalEvidence>> {
  await writes;
  const sourceBytes = await fs.readFile(sourceFile);
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const source = JSON.parse(sourceBytes.toString('utf8')) as { rows: HistoricalRow[] };
  const original = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'source.json'), 'utf8')) as {
    rows: Array<{ scanId: number; sourceImageUrl: string }>;
  };
  const urls = new Map(original.rows.map(row => [row.scanId, row.sourceImageUrl]));
  if (!Array.isArray(source.rows) || source.rows.length !== dataset.rows.length ||
    new Set(source.rows.map(row => row.scanId)).size !== dataset.rows.length ||
    source.rows.some(row => !dataset.rows.some(scan => scan.scanId === row.scanId) ||
      !Array.isArray(row.feedback) || row.imageUrl !== urls.get(row.scanId) ||
      !/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/[^?#]+\/scan_uploads\/[^?#]+$/i.test(row.imageUrl) ||
      typeof row.createdAt !== 'string'))
    throw new ReviewError('Historical confirmation extract does not match all 60 saved Cloudinary scan origins', 503);
  const records = source.rows.map(historicalEvidence);
  let existing: any;
  try { existing = JSON.parse(await fs.readFile(reportFile, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (existing.datasetHash !== dataset.datasetHash ||
      existing.sourceSha256 !== sourceSha256 || JSON.stringify(existing.records) !== JSON.stringify(records))
      throw new ReviewError('Persisted historical label report differs from the immutable source extract', 503);
  } else {
    const task = writes.then(() => atomicReviewJson('historical-labels-report.json', {
      schema: 'scan-historical-provenance-v1', datasetHash: dataset.datasetHash,
      sourceSha256, sourceTable: 'scan_uploads joined by scan_upload_id to scan_feedback',
      imageOrigin: 'Cloudinary scan_uploads; review serves SHA256-verified local original-byte copies',
      ownershipProof: 'none: user_collections has no scan_upload_id link; timestamp proximity is not identity evidence',
      candidateOrigin: 'Frozen historical matcher snapshot; not a DINO retrieval or combined rerank',
      records,
    }));
    writes = task.catch(() => {});
    await task;
  }
  return new Map(records.map(row => [row.scanId, row]));
}

export function resolveHistoricalLabel(evidence: HistoricalEvidence,
  manual: { status: string; cardId: number | null } | null, side: string,
  existingCardIds: ReadonlySet<number>,
  exactPeers: ReadonlyMap<number, { canonicalActiveId: number | null; equivalentIds: number[] }>,
  isArchived: (id: number) => boolean) {
  const historicalId = evidence.candidateHistoricalCardId;
  const manualId = manual?.status === 'confirmed' ? manual.cardId : null;
  const equivalent = !!historicalId && !!manualId &&
    (historicalId === manualId || (exactPeers.get(historicalId)?.equivalentIds.includes(manualId) ?? false));
  const comparison = !manualId ? 'not-manually-confirmed' : !historicalId
    ? 'no-historical-selection' : historicalId === manualId ? 'exact-id'
      : equivalent ? 'verified-exact-catalog-equivalence' : 'different-identity-or-parallel';
  const archiveAmbiguity = !!historicalId && isArchived(historicalId) &&
    exactPeers.get(historicalId)?.canonicalActiveId == null;
  const contradiction = !!historicalId && (
    (manualId != null && !equivalent) || manual?.status === 'unresolved' ||
    !existingCardIds.has(historicalId));
  const category = contradiction ? 'DATA INCONSISTENT'
    : side === 'back' ? 'BACK PHOTO / SPECIAL CASE'
      : evidence.sourceStatus === 'ambiguous' || archiveAmbiguity
        ? 'POSSIBLE HISTORICAL LABEL BUT AMBIGUOUS'
        : historicalId ? 'CONFIRMED HISTORICAL LABEL AVAILABLE' : 'NO HISTORICAL LABEL';
  // Do not silently rewrite archived IDs or guess whether different legacy sets
  // are equivalent. A historical label is admitted only if its catalog ID exists
  // and is active, or has exactly one structurally verified active equivalent.
  const historicalAdmitted = category === 'CONFIRMED HISTORICAL LABEL AVAILABLE';
  const effectiveLabel = manualId != null
    ? { cardId: manualId, source: 'manual-review' as const }
    : historicalAdmitted ? { cardId: historicalId!, source: 'historical-user-confirmation' as const } : null;
  return {
    ...evidence, category, comparison,
    manualCardId: manualId, historicalCardId: historicalId,
    archivalAmbiguity: archiveAmbiguity,
    exactEquivalentIds: historicalId ? exactPeers.get(historicalId)?.equivalentIds ?? [] : [],
    historicalAdmitted, effectiveLabel,
    manualContradiction: contradiction && manualId != null,
    evidenceLimit: 'Collector explicitly selected this ID when pressing Confirm; feedback precedes collection write, so successful ownership cannot be inferred.',
  };
}
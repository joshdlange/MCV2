import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { REVIEW_DIR, ReviewError } from './scanReview';

export type PhotoAuditRow = {
  scanId: number; bestReferenceCardId: number | null; mae: number | null;
  correlation: number | null;
  overlap: 'not-exact' | 'no-linked-cloudinary-reference' | 'exact-self-linked-scan-upload';
  context: 'visible-photo-context' | 'indeterminate';
  referenceSource?: string;
};
export async function loadPhotoOriginAudit(scanIds: number[]) {
  const bytes = await fs.readFile(path.join(REVIEW_DIR, 'photo-origin-audit.json'));
  const audit = JSON.parse(bytes.toString('utf8')) as {
    schema: string; scope: string; method: Record<string, string>;
    counts: Record<string, number | null>; rows: PhotoAuditRow[];
    limitations: string[];
  };
  const source = JSON.parse(await fs.readFile(path.join(REVIEW_DIR, 'source.json'), 'utf8')) as {
    rows: Array<{ scanId: number; sourceImageUrl: string;
      candidate?: { imageUrl?: string } | null; prediction?: { imageUrl?: string } | null }>;
  };
  const origins = new Map(source.rows.map(row => [row.scanId, row]));
  if (audit.schema !== 'private-photo-origin-audit-v1' || !Array.isArray(audit.rows) ||
    audit.rows.length !== scanIds.length || new Set(audit.rows.map(row => row.scanId)).size !== scanIds.length ||
    audit.rows.some(row => !scanIds.includes(row.scanId) ||
      !['visible-photo-context', 'indeterminate'].includes(row.context) ||
      !['not-exact', 'no-linked-cloudinary-reference', 'exact-self-linked-scan-upload'].includes(row.overlap) ||
      (row.overlap === 'exact-self-linked-scan-upload' &&
        ![origins.get(row.scanId)?.candidate?.imageUrl, origins.get(row.scanId)?.prediction?.imageUrl]
          .includes(origins.get(row.scanId)?.sourceImageUrl))) ||
    audit.counts.integrityVerified !== 60 || audit.counts.uniqueFetchedLinkedCloudinaryUrls !== 57 ||
    audit.counts.scansWithFetchedLinkedCloudinaryReference !== 48 ||
    audit.counts.exactBytesIndependentCatalogReference !== 0 ||
    audit.rows.filter(row => row.context === 'visible-photo-context').length !== audit.counts.visiblePhotoContext ||
    audit.rows.filter(row => row.context === 'indeterminate').length !== audit.counts.indeterminateVisualContext ||
    audit.rows.filter(row => row.overlap === 'exact-self-linked-scan-upload').length !== 1 ||
    audit.rows.find(row => row.overlap === 'exact-self-linked-scan-upload')?.scanId !== 3029 ||
    audit.rows.filter(row => row.overlap === 'no-linked-cloudinary-reference').length !== 12 ||
    audit.rows.filter(row => row.overlap === 'not-exact').length !== 47)
    throw new ReviewError('Photo-origin audit does not match the saved 60-scan originals and linked references', 503);
  return { sha256: createHash('sha256').update(bytes).digest('hex'),
    counts: audit.counts, scope: audit.scope, method: audit.method,
    limitations: audit.limitations,
    rows: new Map(audit.rows.map(row => [row.scanId, row])) };
}
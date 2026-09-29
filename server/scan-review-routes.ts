import type { Express, RequestHandler } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';
import { downloadCatalogReference } from './services/catalogVisualFetch';
import {
  approvedLabels, loadScanMetadata, originalScanBytes, referenceBytes, reviewProgress,
  ReviewError, requireDevelopmentAdmin, saveScanDecision, scanReviewState,
} from './services/scanReview';
import { legacyReviewEvidence, readReviewFlags, updateReviewFlags } from './services/scanReviewFlags';
import { auditReviewEquivalence, searchReviewCatalog } from './services/scanReviewSearch';
import {
  cardNumberEvidence, effectiveClassification, REVIEW_DEVELOPMENT_CASES,
  readReviewClassifications, sanitizeOcr, sanitizeVision, saveReviewClassification,
} from './services/scanReviewClassification';

type Candidate = { cardId: number; name: string; year: number | null; mainSetName: string | null;
  subsetName: string | null; cardNumber: string | null; imageUrl: string | null;
  confidence?: number; confidenceLevel?: string; similarity?: number; matchReasons?: string[];
  isArchived?: boolean | null; status?: 'active' | 'archived' | null; hasUsableVisualReference?: boolean;
  canonicalActiveId?: number | null; equivalentIds?: number[] };
const base = '/api/admin/scan-review';
const middleware = requireDevelopmentAdmin;
function failure(res: any, error: unknown) {
  const status = error instanceof ReviewError ? error.status : 503;
  res.status(status).json({ message: error instanceof Error ? error.message : 'Scan review unavailable' });
}
const validId = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null;
async function catalogCards(ids: number[]) {
  const map = new Map<number, Candidate>();
  if (!ids.length) return map;
  const { rows } = await pool.query(`SELECT c.id AS "cardId", c.name, c.card_number AS "cardNumber",
      s.year, s.name AS "subsetName", COALESCE(m.name,s.name) AS "mainSetName",
      c.front_image_url AS "frontImageUrl",
      (c.archived_at IS NOT NULL OR s.archived_at IS NOT NULL OR NOT s.is_active
        OR (m.id IS NOT NULL AND (m.archived_at IS NOT NULL OR NOT m.is_active))) AS "isArchived"
    FROM cards c JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN main_sets m ON m.id=s.main_set_id
    WHERE c.id=ANY($1::int[])`, [ids]);
  for (const row of rows) map.set(row.cardId, {
    cardId: row.cardId, name: row.name, cardNumber: row.cardNumber, year: row.year,
    subsetName: row.subsetName, mainSetName: row.mainSetName,
    imageUrl: row.frontImageUrl ? `${base}/image/card/${row.cardId}` : null,
    isArchived: row.isArchived,
    status: row.isArchived ? 'archived' : 'active',
    hasUsableVisualReference: !row.isArchived && /^https?:\/\//.test(row.frontImageUrl ?? '')
      && !/(drive\.google\.com|googleusercontent\.com)/i.test(row.frontImageUrl ?? ''),
  });
  return map;
}
function reviewEligibility(scanId: number, decision: { status: string; cardId: number | null; note: string } | null,
  classification: ReturnType<typeof effectiveClassification>,
  flags: Awaited<ReturnType<typeof readReviewFlags>>, cards: Map<number, Candidate>) {
  const selected = decision?.cardId ? cards.get(decision.cardId) : null;
  const target = selected?.isArchived ? cards.get(selected.canonicalActiveId ?? -1) : selected;
  const searchBlocked = flags.searchBlocked[scanId]?.blocked ||
    legacyReviewEvidence(decision).suspectedSearchBlocked;
  const catalogImageIssue = Object.values(flags.issues).some(issue =>
    issue.scanId === scanId && issue.cardId === decision?.cardId) ||
    legacyReviewEvidence(decision).reviewerReportedImageIssue;
  const excludedDueToToolCatalogIssue = !!(searchBlocked || catalogImageIssue ||
    (decision?.status === 'confirmed' && !target?.hasUsableVisualReference));
  const identityConfirmed = decision?.status === 'confirmed' && !!target;
  return {
    frontImageRetrieval: identityConfirmed && classification.side === 'front'
      && !!target?.hasUsableVisualReference && !excludedDueToToolCatalogIssue,
    backOcr: identityConfirmed && classification.side === 'back' &&
      classification.ocrTag !== 'empty' && !excludedDueToToolCatalogIssue,
    metadataParsing: identityConfirmed && classification.ocrTag !== 'empty' &&
      classification.metadataParsing.status === 'supported' &&
      !!classification.metadataParsing.reason && !excludedDueToToolCatalogIssue,
    excludedDueToToolCatalogIssue,
    reasons: [
      ...(searchBlocked ? ['search-tool-blocked'] : []),
      ...(catalogImageIssue ? ['catalog-image-issue'] : []),
      ...(decision?.status === 'confirmed' && !target?.hasUsableVisualReference
        ? ['missing-or-unsupported-active-reference'] : []),
      ...(classification.side !== 'front' ? [`side-${classification.side}`] : []),
      ...(decision?.status !== 'confirmed' ? ['identity-not-confirmed'] : []),
    ],
  };
}
function dataQuality(rows: { scanId: number }[], decisions: Record<string, { status: string; cardId: number | null; note: string }>,
  flags: Awaited<ReturnType<typeof readReviewFlags>>, cards: Map<number, Candidate>,
  classifications: Awaited<ReturnType<typeof readReviewClassifications>>,
  metadata: Awaited<ReturnType<typeof loadScanMetadata>>) {
  const progress = reviewProgress(decisions as any, rows.length);
  const blocked = rows.filter(row => flags.searchBlocked[row.scanId]?.blocked ||
    legacyReviewEvidence(decisions[row.scanId] ?? null).suspectedSearchBlocked).length;
  const confirmed = rows.filter(row => decisions[row.scanId]?.status === 'confirmed');
  const flagged = confirmed.filter(row => Object.values(flags.issues).some(issue =>
    issue.scanId === row.scanId && issue.cardId === decisions[row.scanId].cardId)
    || legacyReviewEvidence(decisions[row.scanId]).reviewerReportedImageIssue);
  const missing = confirmed.filter(row => {
    const selected = cards.get(decisions[row.scanId].cardId!);
    const reference = selected?.isArchived ? cards.get(selected.canonicalActiveId ?? -1) : selected;
    return !reference?.hasUsableVisualReference;
  });
  // Unknown/archived canonical relationships are not silently resolved; explicit
  // active catalog identity and a usable public reference are minimum eligibility.
  const suitable = confirmed.filter(row => {
    const card = cards.get(decisions[row.scanId].cardId!);
    const target = card?.isArchived ? cards.get(card.canonicalActiveId ?? -1) : card;
    return target && target.hasUsableVisualReference
      && !flagged.includes(row) && !missing.includes(row);
  });
  const classified = rows.map(row => {
    const decision = decisions[row.scanId] ?? null;
    const saved = metadata.get(row.scanId);
    const classification = effectiveClassification(row.scanId, decision,
      classifications.classifications[row.scanId], saved?.ocr ?? null);
    return { row, decision, classification,
      eligibility: reviewEligibility(row.scanId, decision, classification, flags, cards),
    };
  });
  const reviewedClassified = classified.filter(item =>
    item.decision?.status === 'confirmed' || item.decision?.status === 'unresolved');
  return {
    ...progress, scansBlockedBySearch: blocked,
    legacySuspectedSearchBlocked: rows.filter(row =>
      legacyReviewEvidence(decisions[row.scanId] ?? null).suspectedSearchBlocked).length,
    confirmedCardsWithEquivalentIds: confirmed.filter(row =>
      (cards.get(decisions[row.scanId].cardId!)?.equivalentIds?.length ?? 0) > 0).length,
    confirmedCardsWithFlaggedCatalogImageIssues: flagged.length,
    reviewerReportedLegacyImageIssues: confirmed.filter(row =>
      legacyReviewEvidence(decisions[row.scanId]).reviewerReportedImageIssue).length,
    confirmedCardsMissingUsableReferenceImages: missing.length,
    confirmedLabelsSuitableForVisualBenchmark: suitable.length,
    reviewedFront: reviewedClassified.filter(item => item.classification.side === 'front').length,
    reviewedBack: reviewedClassified.filter(item => item.classification.side === 'back').length,
    reviewedUncertain: reviewedClassified.filter(item => item.classification.side === 'uncertain').length,
    frontImageRetrievalEligible: classified.filter(item => item.eligibility.frontImageRetrieval).length,
    backOcrEligible: classified.filter(item => item.eligibility.backOcr).length,
    metadataParsingEligible: classified.filter(item => item.eligibility.metadataParsing).length,
    excludedDueToToolCatalogIssue: classified.filter(item => item.eligibility.excludedDueToToolCatalogIssue).length,
    confirmedOcrEmpty: classified.filter(item => item.decision?.status === 'confirmed'
      && item.classification.ocrTag === 'empty').length,
    regressionDevelopmentScans: Object.keys(REVIEW_DEVELOPMENT_CASES).map(Number),
    holdoutAssigned: 0,
    suitabilityCriteria: 'Confirmed, selected active card or archived card with one exact-identity active equivalent, HTTPS/HTTP non-Drive front reference, no reported/flagged image issue. Exact identity requires matching name, year, main set, subset, card number and variation.',
    provenance: 'Legacy note matches are reported separately as suspected/reviewer-reported, not edited or verified flags.',
  };
}
async function response() {
  const { dataset, decisions } = await scanReviewState();
  const metadata = await loadScanMetadata();
  const flags = await readReviewFlags(dataset.datasetHash);
  const classifications = await readReviewClassifications(dataset.datasetHash);
  const ids = [...new Set([
    ...[...metadata.values()].flatMap(row => row.candidates.map(c => c.cardId)),
    ...dataset.rows.flatMap(row => [row.candidate?.cardId, row.prediction?.cardId]),
    ...Object.values(decisions).map(decision => decision.cardId),
  ].filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id)))];
  const cards = await catalogCards(ids);
  const audit = await auditReviewEquivalence([...new Set(Object.values(decisions)
    .map(decision => decision.cardId)
    .filter((id): id is number => typeof id === 'number'))]);
  const canonicalIds = [...audit.values()].map(value => value.canonicalActiveId)
    .filter((id): id is number => id !== null && !cards.has(id));
  for (const [id, card] of await catalogCards(canonicalIds)) cards.set(id, card);
  for (const [id, record] of cards) {
    const equivalent = audit.get(id);
    record.equivalentIds = equivalent?.equivalentIds ?? [];
    record.canonicalActiveId = record.isArchived ? equivalent?.canonicalActiveId ?? null : id;
  }
  return {
    datasetHash: dataset.datasetHash,
    items: await Promise.all(dataset.rows.map(async row => {
      const saved = metadata.get(row.scanId)!;
      const classification = effectiveClassification(row.scanId, decisions[row.scanId] ?? null,
        classifications.classifications[row.scanId], saved.ocr);
      const numberEvidence = await cardNumberEvidence(saved.ocr, saved.vision, async (number, year, hint) => {
        const historicalCandidate = saved.candidates.some(candidate =>
          candidate.cardNumber?.toLowerCase() === number.toLowerCase() &&
          (year === null || candidate.year === year) &&
          (!hint || /fleer|ultra|topps|skybox|impe[l]/i.test(hint) &&
            hint.toLowerCase().split(/\s+/).filter(token => token.length > 3)
              .some(token => (candidate.setName ?? '').toLowerCase().includes(token))));
        if (historicalCandidate) return true;
        // A surprising artist-number pattern requires independent live catalog evidence,
        // rather than being promoted to a hard number from an OCR surname and year.
        if (!/^[A-Z]{3,}-\d{2,4}$/i.test(number)) return false;
        const terms = (hint ?? '').toLowerCase().split(/\s+/).filter(token => /^[a-z]{4,}$/.test(token));
        const result = await pool.query(`SELECT 1 FROM cards c JOIN card_sets s ON s.id=c.set_id
          LEFT JOIN main_sets m ON m.id=s.main_set_id
          WHERE lower(c.card_number)=lower($1) AND ($2::int IS NULL OR s.year=$2)
          AND ($3::text[]='{}'::text[] OR EXISTS (SELECT 1 FROM unnest($3::text[]) term
            WHERE strpos(lower(concat_ws(' ', s.name,m.name)), term)>0))
          LIMIT 1`, [number, year, terms]);
        return result.rows.length > 0;
      });
      // The older prepared pack contains actual saved suggestions for two scans
      // without historical ranked candidates. Do not synthesize missing rankings.
      const suggestions = [...saved.candidates];
      if (suggestions.length < 3) for (const suggestion of [row.candidate, row.prediction]) {
        if (suggestion && !suggestions.some(item => item.cardId === suggestion.cardId)) {
          suggestions.push({ ...suggestion, imageUrl: null });
        }
      }
      return {
        scanId: row.scanId, imageHash: row.imageHash, filename: path.basename(row.originalPhotoFile),
        imageUrl: `${base}/image/scan/${row.scanId}`,
        topCardId: saved.topCardId ?? row.candidate?.cardId ?? row.prediction?.cardId ?? null,
        candidates: suggestions.map(candidate => {
          const live = cards.get(candidate.cardId);
          // The candidate ranking and confidence are frozen historical snapshots, not a new search.
          return {
            cardId: candidate.cardId, name: live?.name ?? candidate.name,
            year: live?.year ?? candidate.year ?? null,
            mainSetName: live?.mainSetName ?? null,
            subsetName: live?.subsetName ?? candidate.subsetName ?? candidate.setName ?? null,
            cardNumber: live?.cardNumber ?? candidate.cardNumber ?? null,
            imageUrl: live?.imageUrl ?? (candidate.imageUrl || (row.candidate?.cardId === candidate.cardId
              && !!row.references[0]) || (row.prediction?.cardId === candidate.cardId
              && !!row.references[1])
              ? `${base}/image/snapshot/${row.scanId}/${candidate.cardId}` : null),
            ...(candidate.confidence == null ? {} : { confidence: candidate.confidence }),
            ...(candidate.confidenceLevel == null ? {} : { confidenceLevel: candidate.confidenceLevel }),
            ...(candidate.matchReasons == null ? {} : { matchReasons: candidate.matchReasons }),
            ...(candidate.similarity == null ? {} : { similarity: candidate.similarity }),
            isArchived: live?.isArchived ?? null,
            status: live?.status ?? null,
            canonicalActiveId: live?.canonicalActiveId ?? null,
            equivalentIds: live?.equivalentIds ?? [],
          } satisfies Candidate;
        }),
        ocr: saved.ocr, vision: saved.vision, confidence: saved.confidence ?? null,
        reviewEvidence: {
          ocr: sanitizeOcr(saved.ocr),
          vision: sanitizeVision(saved.vision),
          cardNumber: numberEvidence,
          historicalCandidateRankingContaminated: [3082, 3120].includes(row.scanId),
          note: 'Historical OCR/vision/ranking are preserved unchanged; sanitized review evidence must not constrain catalog search.',
        },
        decision: decisions[row.scanId] ?? null,
        selectedCard: decisions[row.scanId]?.cardId ? cards.get(decisions[row.scanId].cardId!) ?? null : null,
        imageIssues: Object.values(flags.issues).filter(issue => issue.scanId === row.scanId),
        searchBlocked: flags.searchBlocked[row.scanId] ?? null,
        legacyEvidence: legacyReviewEvidence(decisions[row.scanId] ?? null),
        classification,
        imageOnlyCase: classification.ocrTag === 'empty',
        eligibility: reviewEligibility(row.scanId, decisions[row.scanId] ?? null, classification, flags, cards),
        evaluationCohort: REVIEW_DEVELOPMENT_CASES[row.scanId] ? {
          cohort: 'development', reason: REVIEW_DEVELOPMENT_CASES[row.scanId],
        } : { cohort: 'unassigned', reason: null },
      };
    })),
    progress: reviewProgress(decisions, dataset.rows.length),
    benchmark: { status: 'blocked', message: 'Benchmark is disabled pending explicit user authorization.',
      confirmedLabels: approvedLabels(dataset.rows, decisions).length },
    dataQuality: dataQuality(dataset.rows, decisions, flags, cards, classifications, metadata),
  };
}
export function registerScanReviewRoutes(app: Express, authenticateUser: RequestHandler) {
  // Authentication and admin/development gates apply independently to EVERY endpoint, including images.
  app.get(base, authenticateUser, middleware, async (_req, res) => {
    try { res.json(await response()); } catch (e) { failure(res, e); }
  });
  app.put(`${base}/:scanId`, authenticateUser, middleware, async (req: any, res) => {
    try {
      const scanId = validId(req.params.scanId);
      if (!scanId) throw new ReviewError('Invalid scan ID', 400);
      await saveScanDecision(scanId, req.body, req.user.id, async id => (await catalogCards([id])).has(id));
      res.json(await response());
    } catch (e) { failure(res, e); }
  });
  app.get(`${base}/catalog`, authenticateUser, middleware, async (req, res) => {
    try { res.json(await searchReviewCatalog(req.query)); } catch (e) { failure(res, e); }
  });
  app.get(`${base}/data-quality`, authenticateUser, middleware, async (_req, res) => {
    try { res.json((await response()).dataQuality); } catch (e) { failure(res, e); }
  });
  app.put(`${base}/:scanId/classification`, authenticateUser, middleware, async (req: any, res) => {
    try {
      const { dataset, decisions } = await scanReviewState();
      const scanId = validId(req.params.scanId);
      if (!scanId || !dataset.rows.some(row => row.scanId === scanId))
        throw new ReviewError('Unknown scan ID', 404);
      await saveReviewClassification(dataset.datasetHash, scanId, req.body, req.user.id,
        decisions[scanId]?.status ?? null);
      res.json(await response());
    } catch (e) { failure(res, e); }
  });
  app.put(`${base}/:scanId/search-blocked`, authenticateUser, middleware, async (req: any, res) => {
    try {
      const { dataset } = await scanReviewState();
      const scanId = validId(req.params.scanId);
      if (!scanId || !dataset.rows.some(row => row.scanId === scanId))
        throw new ReviewError('Unknown scan ID', 404);
      await updateReviewFlags(dataset.datasetHash, req.body, req.user.id, { scanId });
      res.json(await response());
    } catch (e) { failure(res, e); }
  });
  app.put(`${base}/:scanId/image-issues/:cardId`, authenticateUser, middleware, async (req: any, res) => {
    try {
      const { dataset } = await scanReviewState();
      const scanId = validId(req.params.scanId), cardId = validId(req.params.cardId);
      if (!scanId || !dataset.rows.some(row => row.scanId === scanId))
        throw new ReviewError('Unknown scan ID', 404);
      if (!cardId || !(await catalogCards([cardId])).has(cardId))
        throw new ReviewError('Unknown catalog card ID', 404);
      await updateReviewFlags(dataset.datasetHash, req.body, req.user.id, { scanId, cardId });
      res.json(await response());
    } catch (e) { failure(res, e); }
  });
  app.delete(`${base}/:scanId/image-issues/:cardId`, authenticateUser, middleware, async (req: any, res) => {
    try {
      const { dataset } = await scanReviewState();
      const scanId = validId(req.params.scanId), cardId = validId(req.params.cardId);
      if (!scanId || !dataset.rows.some(row => row.scanId === scanId) || !cardId)
        throw new ReviewError('Unknown scan or card ID', 404);
      await updateReviewFlags(dataset.datasetHash, req.body, req.user.id, { scanId, cardId, remove: true });
      res.json(await response());
    } catch (e) { failure(res, e); }
  });
  app.get(`${base}/image/:kind/:scanId/:cardId?`, authenticateUser, middleware, async (req, res) => {
    try {
      const id = validId(req.params.scanId);
      if (!id) throw new ReviewError('Invalid image ID', 400);
      let bytes: Buffer, mime = 'image/jpeg';
      if (req.params.kind === 'card') {
        const { rows } = await pool.query(`SELECT front_image_url FROM cards WHERE id=$1`, [id]);
        const url: string | null = rows[0]?.front_image_url;
        if (!url) throw new ReviewError('Reference image unavailable', 404);
        if (url.startsWith('/uploads/')) {
          const name = url.slice('/uploads/'.length);
          if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.'))
            throw new ReviewError('Reference image unavailable', 404);
          bytes = await fs.readFile(path.resolve(process.cwd(), 'uploads', name));
        } else bytes = await downloadCatalogReference(url);
      } else {
        const { dataset } = await scanReviewState();
        const row = dataset.rows.find(item => item.scanId === id);
        if (!row) throw new ReviewError('Unknown scan', 404);
        if (req.params.kind === 'scan') {
          bytes = await originalScanBytes(row);
          mime = row.originalPhotoFile.endsWith('.png') ? 'image/png'
            : row.originalPhotoFile.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        } else if (req.params.kind === 'snapshot') {
          const candidateId = validId(req.params.cardId);
          const metadata = (await loadScanMetadata()).get(id);
          const index = candidateId === row.candidate?.cardId ? 0
            : candidateId === row.prediction?.cardId ? 1 : -1;
          const preview = index >= 0 ? referenceBytes(row, index) : null;
          const snapshot = metadata?.candidates.find(candidate => candidate.cardId === candidateId);
          if (preview) bytes = preview;
          else if (snapshot?.imageUrl?.startsWith('/uploads/')) {
            const name = snapshot.imageUrl.slice('/uploads/'.length);
            if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.'))
              throw new ReviewError('Reference image unavailable', 404);
            bytes = await fs.readFile(path.resolve(process.cwd(), 'uploads', name));
          } else if (snapshot?.imageUrl) bytes = await downloadCatalogReference(snapshot.imageUrl);
          else throw new ReviewError('Reference image unavailable', 404);
        } else throw new ReviewError('Unknown image kind', 404);
      }
      if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
      else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
        mime = 'image/webp';
      else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = 'image/jpeg';
      else if (bytes.toString('ascii', 0, 3) === 'GIF') mime = 'image/gif';
      else if (bytes.toString('ascii', 4, 12).includes('ftypavif')) mime = 'image/avif';
      else throw new ReviewError('Unsupported reference image format', 415);
      res.set('Cache-Control', 'private, no-store');
      res.type(mime).send(bytes);
    } catch (e) { failure(res, e); }
  });
  app.post(`${base}/benchmark`, authenticateUser, middleware, (_req, res) => {
    res.status(423).json({ message: 'Benchmark disabled pending explicit user authorization; no retrieval is run.' });
  });
}
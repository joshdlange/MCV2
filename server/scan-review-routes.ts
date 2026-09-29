import type { Express, RequestHandler } from 'express';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';
import { downloadCatalogReference } from './services/catalogVisualFetch';
import { CATALOG, ELIGIBLE, MODEL_VERSION, queryCatalogByImage } from './services/catalogVisual';
import {
  allLabeledCardsExist, approvedLabels, loadScanMetadata, originalScanBytes, readScanBenchmark, referenceBytes, reviewProgress,
  ReviewError, requireBenchmarkLabels, requireDevelopmentAdmin, saveScanBenchmark, saveScanDecision, scanReviewState,
} from './services/scanReview';

type Candidate = { cardId: number; name: string; year: number | null; mainSetName: string | null;
  subsetName: string | null; cardNumber: string | null; imageUrl: string | null;
  confidence?: number; confidenceLevel?: string; similarity?: number; matchReasons?: string[] };
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
      c.front_image_url AS "frontImageUrl"
    FROM cards c JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN main_sets m ON m.id=s.main_set_id
    WHERE c.id=ANY($1::int[]) AND c.archived_at IS NULL AND s.archived_at IS NULL
      AND (m.id IS NULL OR m.archived_at IS NULL)`, [ids]);
  for (const row of rows) map.set(row.cardId, {
    cardId: row.cardId, name: row.name, cardNumber: row.cardNumber, year: row.year,
    subsetName: row.subsetName, mainSetName: row.mainSetName,
    imageUrl: row.frontImageUrl ? `${base}/image/card/${row.cardId}` : null,
  });
  return map;
}
const benchmark: {
  status: 'idle' | 'running' | 'completed' | 'failed'; jobId: string | null; startedAt?: string;
  finishedAt?: string; processed?: number; total?: number; error?: string; results?: unknown;
} = { status: 'idle', jobId: null };
async function response() {
  const { dataset, decisions } = await scanReviewState();
  const metadata = await loadScanMetadata();
  const storedBenchmark = benchmark.status === 'idle' ? await readScanBenchmark(dataset.datasetHash) : null;
  const ids = [...new Set([
    ...[...metadata.values()].flatMap(row => row.candidates.map(c => c.cardId)),
    ...dataset.rows.flatMap(row => [row.candidate?.cardId, row.prediction?.cardId]),
    ...Object.values(decisions).map(decision => decision.cardId),
  ].filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id)))];
  const cards = await catalogCards(ids);
  return {
    datasetHash: dataset.datasetHash,
    items: dataset.rows.map(row => {
      const saved = metadata.get(row.scanId)!;
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
          } satisfies Candidate;
        }),
        ocr: saved.ocr, vision: saved.vision, confidence: saved.confidence ?? null,
        decision: decisions[row.scanId] ?? null,
        selectedCard: decisions[row.scanId]?.cardId ? cards.get(decisions[row.scanId].cardId!) ?? null : null,
      };
    }),
    progress: reviewProgress(decisions, dataset.rows.length),
    benchmark: { ...(storedBenchmark ?? benchmark), minimumConfirmed: 50,
      confirmedLabels: approvedLabels(dataset.rows, decisions).length },
  };
}
type FrozenLabel = { scanId: number; imageHash: string; cardId: number; reviewerId: number; reviewedAt: string };
async function runBenchmark(jobId: string, frozen: FrozenLabel[], datasetHash: string) {
  try {
    const { dataset } = await scanReviewState();
    if (dataset.datasetHash !== datasetHash) throw new Error('Saved scan dataset changed during benchmark');
    const uniqueIds = [...new Set(frozen.map(label => label.cardId))];
    const valid = await catalogCards(uniqueIds);
    if (!allLabeledCardsExist(uniqueIds, new Set(valid.keys())))
      throw new Error('Confirmed labels include archived or missing catalog cards; resolve these labels before benchmarking');
    // Coverage means the correct card's own current reference is indexed, not merely that some references exist.
    const coverage = await pool.query(`SELECT DISTINCT c.id ${CATALOG}
      JOIN catalog_visual_references r ON r.reference_url=c.front_image_url
      AND r.model_version=$2 AND r.status='ready'
      WHERE c.id=ANY($1::int[]) AND ${ELIGIBLE}`, [uniqueIds, MODEL_VERSION]);
    const coveredIds = new Set<number>(coverage.rows.map(row => row.id));
    const indexedLabelCoverage = frozen.filter(label => coveredIds.has(label.cardId)).length;
    let evaluatedCovered = 0, top1 = 0, top3 = 0, top10 = 0, unavailable = 0;
    const errors: Array<{ scanId: number; message: string }> = [];
    const scans: Array<{
      scanId: number; imageHash: string; cardId: number; indexedGroundTruth: boolean;
      retrievalStatus: string; latencyMs: number; rank: number | null;
      matches: { cardId: number; similarity: number }[];
      top1Top2Margin: number | null; groundTruthMargin: number | null; error: string | null;
    }> = [];
    for (const label of frozen) {
      const { scanId, cardId } = label;
      // Never substitute a reference, preview, or scan log URL for the frozen original.
      const started = performance.now();
      let status = 'unavailable', matches: { cardId: number; similarity: number }[] = [];
      let error: string | null = null;
      try {
        const row = dataset.rows.find(item => item.scanId === scanId);
        if (!row || row.imageHash !== label.imageHash) throw new Error('Frozen original changed');
        const result = await queryCatalogByImage(await originalScanBytes(row), 10);
        status = result.status;
        matches = result.matches;
        error = result.error ?? null;
        if (status === 'unavailable') unavailable++;
        else if (coveredIds.has(cardId)) evaluatedCovered++;
      } catch (e) {
        unavailable++;
        error = e instanceof Error ? e.message : 'Visual retrieval failed';
      }
      const index = matches.findIndex(match => match.cardId === cardId);
      const rank = index < 0 ? null : index + 1;
      if (rank === 1) top1++;
      if (rank !== null && rank <= 3) top3++;
      if (rank !== null && rank <= 10) top10++;
      if (error) errors.push({ scanId, message: error });
      const other = matches.find(match => match.cardId !== cardId);
      scans.push({
        scanId, imageHash: label.imageHash, cardId, indexedGroundTruth: coveredIds.has(cardId),
        retrievalStatus: status, latencyMs: Math.round((performance.now() - started) * 100) / 100,
        rank, matches, error,
        top1Top2Margin: matches.length > 1 ? matches[0].similarity - matches[1].similarity : null,
        groundTruthMargin: rank !== null && other ? matches[index].similarity - other.similarity : null,
      });
      benchmark.processed = (benchmark.processed ?? 0) + 1;
    }
    if (benchmark.jobId !== jobId) return;
    benchmark.results = {
      datasetHash, modelVersion: MODEL_VERSION, frozenLabels: frozen,
      confirmedLabels: frozen.length, indexedLabelCoverage, evaluatedCovered,
      unindexedLabels: frozen.length - indexedLabelCoverage, unavailableQueries: unavailable,
      top1Hits: top1, top3Hits: top3, top10Hits: top10,
      top1Accuracy: top1 / frozen.length, top3Accuracy: top3 / frozen.length,
      top10Accuracy: top10 / frozen.length,
      top1AccuracyCovered: indexedLabelCoverage ? scans.filter(s => s.indexedGroundTruth && s.rank === 1).length / indexedLabelCoverage : null,
      top3AccuracyCovered: indexedLabelCoverage ? scans.filter(s => s.indexedGroundTruth && s.rank !== null && s.rank <= 3).length / indexedLabelCoverage : null,
      top10AccuracyCovered: indexedLabelCoverage ? scans.filter(s => s.indexedGroundTruth && s.rank !== null && s.rank <= 10).length / indexedLabelCoverage : null,
      note: 'All-label accuracy includes unindexed ground truth and failed retrievals as misses; covered accuracy uses indexed ground-truth labels, including failed queries. Coverage is reported separately.',
      scans, errors,
    };
    benchmark.status = 'completed';
  } catch (e) {
    benchmark.status = 'failed';
    benchmark.error = e instanceof Error ? e.message : 'Benchmark failed';
  } finally {
    benchmark.finishedAt = new Date().toISOString();
    if (benchmark.status === 'completed') {
      try { await saveScanBenchmark(datasetHash, { ...benchmark }); }
      catch (e) {
        benchmark.status = 'failed';
        benchmark.error = `Could not persist benchmark: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
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
    try {
      const q = req.query.q;
      if (typeof q !== 'string' || q.trim().length < 2 || q.length > 100)
        throw new ReviewError('Search must be 2–100 characters', 400);
      const { rows } = await pool.query(`SELECT c.id AS "cardId", c.name, c.card_number AS "cardNumber",
        s.year, s.name AS "subsetName", COALESCE(m.name,s.name) AS "mainSetName",
        c.front_image_url AS "frontImageUrl"
        FROM cards c JOIN card_sets s ON s.id=c.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id
        WHERE c.archived_at IS NULL AND s.archived_at IS NULL
        AND (m.id IS NULL OR m.archived_at IS NULL)
        AND (c.name ILIKE $1 OR c.card_number ILIKE $1 OR s.name ILIKE $1 OR m.name ILIKE $1
          OR c.id::text=$2)
        ORDER BY CASE WHEN c.id::text=$2 THEN 0 WHEN lower(c.name)=lower($2) THEN 1 ELSE 2 END,c.id LIMIT 30`,
      [`%${q.trim().replace(/[\\%_]/g, '\\$&')}%`, q.trim()]);
      res.json({ cards: rows.map(row => ({
        cardId: row.cardId, name: row.name, cardNumber: row.cardNumber, year: row.year,
        subsetName: row.subsetName, mainSetName: row.mainSetName,
        imageUrl: row.frontImageUrl ? `${base}/image/card/${row.cardId}` : null,
      })) });
    } catch (e) { failure(res, e); }
  });
  app.get(`${base}/image/:kind/:scanId/:cardId?`, authenticateUser, middleware, async (req, res) => {
    try {
      const id = validId(req.params.scanId);
      if (!id) throw new ReviewError('Invalid image ID', 400);
      let bytes: Buffer, mime = 'image/jpeg';
      if (req.params.kind === 'card') {
        const { rows } = await pool.query(`SELECT front_image_url FROM cards WHERE id=$1 AND archived_at IS NULL`, [id]);
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
  app.post(`${base}/benchmark`, authenticateUser, middleware, async (_req, res) => {
    try {
      if (benchmark.status === 'running') return res.status(409).json({ message: 'Benchmark is already running', benchmark });
      const { dataset, decisions } = await scanReviewState();
      const labels = requireBenchmarkLabels(dataset.rows, decisions);
      const ids = labels.map(label => label.cardId);
      if (!allLabeledCardsExist(ids, new Set((await catalogCards([...new Set(ids)])).keys())))
        throw new ReviewError('Confirmed labels include missing or archived catalog cards', 409);
      const frozen = labels.map(({ row, cardId }) => ({
        scanId: row.scanId, imageHash: row.imageHash, cardId,
        reviewerId: decisions[row.scanId].reviewerId, reviewedAt: decisions[row.scanId].reviewedAt,
      }));
      const jobId = `${Date.now()}-${process.pid}`;
      const pending = { status: 'running', jobId, startedAt: new Date().toISOString(),
        finishedAt: undefined, processed: 0, total: labels.length, error: undefined,
        results: { datasetHash: dataset.datasetHash, modelVersion: MODEL_VERSION, frozenLabels: frozen } };
      await saveScanBenchmark(dataset.datasetHash, pending);
      Object.assign(benchmark, pending);
      res.status(202).json({ benchmark: { ...benchmark } });
      void runBenchmark(jobId, frozen, dataset.datasetHash);
    } catch (e) { failure(res, e); }
  });
}
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Offline report of actual explicitly DEV-scoped SELECT results, not synthetic queries.
const dir = '.local/broad-validation';
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const availability = await read(`${dir}/data-availability.json`);
assert.equal(availability.environment, 'development');
assert.match(availability.confirmation.output, /scan_uploads,0,0/);
assert.match(availability.confirmation.output, /scan_feedback,0,0/);
const provenance = await read('.local/scan-review/provenance.json');
const prior = await read('.local/image-experiment/snapshot.json');
const bounded = await read('.local/bounded-dino/frozen-selection.json');
const files: {path: string; bytes: number; sha256: string}[] = [];
async function walk(path: string) {
  const stat = await fs.stat(path);
  if (stat.isDirectory()) {
    for (const child of (await fs.readdir(path)).sort()) await walk(`${path}/${child}`);
  } else {
    const bytes = await fs.readFile(path);
    files.push({path, bytes: bytes.length, sha256: hash(bytes)});
  }
}
for (const path of ['.local/bounded-dino', '.local/detail-experiment', '.local/detail-orb',
  '.local/image-experiment', '.local/parallel-focus', '.local/scan-review']) await walk(path);
for (const name of (await fs.readdir('scripts')).sort())
  if (/^dev-(bounded|detail|orb|focus|image-experiment|card-normalization|broad)/.test(name)) await walk(`scripts/${name}`);
for (const name of (await fs.readdir('server/services')).sort())
  if (/^catalogVisual/.test(name)) await walk(`server/services/${name}`);
for (const path of ['client/src/pages/scan.tsx', 'server/routes.ts', 'server/storage.ts',
  'shared/schema.ts', 'server/services/scanReviewHistorical.ts',
  'attached_assets/focused-breadth-parallel-results.json', `${dir}/data-availability.json`]) await walk(path);
const freeze = {createdAt: new Date().toISOString(), files};
await fs.writeFile(`${dir}/baseline-freeze.json`, JSON.stringify(freeze, null, 2), {flag: 'wx'});
const exclusions = {
  policy: 'All 60 prepared photos excluded conservatively, plus all previous experiment cases and tuned cohort. No prior photo relabeled as unused.',
  prepared: provenance.selected.map((p: any) => ({scanId: p.scanId, sha256: p.imageHash})),
  previousExperimentIds: prior.cases.map((p: any) => p.scanId),
  tunedIds: bounded.eligible.map((p: any) => p.scanId),
};
const result = {
  status: 'BLOCKED_NO_AUTHORIZED_DEV_QUERIES', createdAt: new Date().toISOString(),
  availability, exclusions,
  frozen: {manifest: `${dir}/baseline-freeze.json`, sha256: hash(JSON.stringify(freeze, null, 2)),
    fileCount: files.length, model: prior.model,
    pipeline: 'Unchanged canonical single-image DINO + FROZEN_DETAIL_POLICY base reranker; optional frozen ORB crop. NO new chroma. No model, pooling, thresholds or UI changes.',
    inferenceStarted: false},
  funnel: {devScanRows: 0, devImageUrls: 0, devFeedbackRows: 0, devSelectedFeedbackRows: 0,
    unusedDevQueries: 0, explicitHistoricalConfirmations: 0, confirmedFronts: 0,
    independentlyVerifiedExactPositiveReferences: 0, eligibleQueries: 0,
    preparedPhotosExposureExcluded: exclusions.prepared.length,
    priorExperimentExposureExcluded: exclusions.previousExperimentIds.length,
    tunedExposureExcluded: exclusions.tunedIds.length,
    catalogRowsWithNonNullFrontUrl: 87839, targetTemporaryIndexCards: 3000,
    temporaryReferenceEmbeddingsCreated: 0, inferenceQueries: 0},
  funnelNotes: 'Exposure counts overlap; they are not subtracted from zero DEV scans. Catalog URL presence is not verified reference availability. Front/reference gates could not be reached. No duplicate or same-capture screening claimed on new images because none exist in DEV.',
  trace: [
    'client/src/pages/scan.tsx confirmCard sends selectedCard.cardId as feedback before asynchronous collection mutation.',
    'server/routes.ts POST /api/cards/scan persists matcher candidates/topMatchCardId; these are predictions, never labels.',
    'server/routes.ts POST /api/cards/scan/:scanUploadId/feedback checks scan owner and records selectedCardId.',
    'shared/schema.ts scan_feedback.scan_upload_id links feedback to scans. Historical selected IDs require same owner, nonconflicting explicit choice, and independent visual exact-front/parallel verification.',
    'Feedback precedes collection save: no successful ownership inference. Timestamps alone never prove identity. Existing manual decisions remain unchanged.',
  ],
  metrics: {exactTop1: null, exactTop3: null, exactTop10: null, parallelSubgroup: null,
    coldProcessingMsExcludingIndexIO: null, warmProcessingMsExcludingIndexIO: null,
    optionalCropAcceptanceRate: null},
  cases: [],
  referencePreparation: 'Not started: zero eligible queries. Building thousands of references cannot repair absent legitimate labels and would not produce a benchmark. No references downloaded, uploaded or permanently indexed.',
  safety: 'Two actual SELECT queries via executeSql(environment=development). No production access, publish, tasks, ownership, label, catalog-image or permanent-index writes. Prior artifacts SHA256 verified unchanged after report generation.',
  blocker: 'Current DEV scan_uploads and scan_feedback are both empty. Previously prepared local historical photos are exposed and excluded; they cannot supply an unused DEV holdout. New legitimate unused scan images with explicit linked selections must be made available in DEV before this authorized benchmark can run.',
  readiness: 'Not evaluated; no production-readiness or accuracy claim.',
};
await fs.writeFile(`${dir}/results.json`, JSON.stringify(result, null, 2));
await fs.writeFile('attached_assets/dev-broad-validation-results.json', JSON.stringify(result, null, 2));
const escape = (v: unknown) => String(v).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]!));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DEV broad validation — data blocker</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#17212d}h1{font-size:30px}.notice{background:#fff3d5;padding:20px;border-left:5px solid #c68612}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #ddd;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}small{color:#536170}</style><h1>Broader frozen-pipeline validation</h1><p class="notice"><b>Blocked: no authorized DEV queries.</b> Actual read-only database checks found zero scan uploads and zero feedback. No inference was run; unavailable metrics are not zero accuracy.</p><h2>Availability funnel</h2><table><tr><th>Gate / count</th><th>Value</th></tr>${Object.entries(result.funnel).map(([k,v])=>`<tr><td>${escape(k)}</td><td>${v}</td></tr>`).join('')}</table><p>${escape(result.funnelNotes)}</p><h2>Exact identity and provenance</h2><ul>${result.trace.map(s=>`<li>${escape(s)}</li>`).join('')}</ul><h2>Per-case results</h2><table><tr><th>Scan</th><th>Verified identity</th><th>Top-1 / 3 / 10</th><th>Crop / latency</th></tr><tr><td colspan="4">No eligible DEV cases. No fabricated labels or replacement benchmark cases.</td></tr></table><h2>Reference preparation and timing</h2><p>${escape(result.referencePreparation)}</p><p>Exact top-1/3/10, parallel subgroup, cold/warm processing time excluding index I/O, and crop rate: <b>not measured</b>.</p><h2>Integrity</h2><p>${escape(result.frozen.pipeline)}</p><p>${files.length} source, prior-result and data files frozen with SHA256. Freeze digest: ${result.frozen.sha256}</p><p>${escape(result.safety)}</p><h2>What blocks completion</h2><p>${escape(result.blocker)}</p><p>${escape(result.readiness)}</p><details><summary>Self-contained machine-readable result</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details></html>`;
await fs.writeFile('attached_assets/dev-broad-validation-report.html', html);
for (const f of files) assert.equal(hash(await fs.readFile(f.path)), f.sha256, `Baseline changed: ${f.path}`);
await fs.writeFile(`${dir}/integrity-check.json`, JSON.stringify({passed:true, checkedFiles:files.length, checkedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({status:result.status, funnel:result.funnel, integrityFiles:files.length}, null, 2));
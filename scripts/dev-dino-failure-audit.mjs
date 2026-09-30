import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Sanitized evidence only: no network, image, model or historical harness imports.
const sourcePath = 'attached_assets/dev-broad-readonly-production-results.json';
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes);
const failures = source.perCase.filter(c => c.rawDinoRank > 1);
assert.equal(source.perCase.length, 41);
assert.equal(failures.length, 12);
assert.equal(failures.filter(c => c.rawDinoRank > 10).length, 6);
const categories = [
  'wrong-looking-reference',
  'same-or-similar-art',
  'parallel-or-variant-ambiguity',
  'perspective-glare-background',
  'too-small',
  'crop-hand-obstruction',
  'genuinely-poor-visual-retrieval',
];
const cases = failures.map(c => {
  const arm = c.arms.find(a => a.input === 'raw' && a.breadth === 10);
  const qa = source.eligibilityDecisions.find(q => q.scanId === c.scanId);
  assert.equal(qa.reason, 'verified-independent-exact-front');
  assert.equal(c.independentExactReferencePresent, true);
  assert.equal(arm.top10CardIds.length, 10);
  assert.equal(arm.top10CardIds.includes(c.confirmedCardId), c.rawDinoRank <= 10);
  return {
    scanId: c.scanId,
    confirmedCardId: c.confirmedCardId,
    dinoRank: c.rawDinoRank,
    top10Miss: c.rawDinoRank > 10,
    description: c.rawDinoRank > 10
      ? `Verified positive present in index but outside DINO top10 (rank ${c.rawDinoRank}); retrieval miss is measured, visual cause is unknown.`
      : `Verified positive retrieved within DINO top10 at rank ${c.rawDinoRank}, but not first; ordering error is measured, visual cause is unknown.`,
    printedInsert: c.printedInsert,
    verifiedExactParallelCase: c.parallel,
    verifiedEvidence: ['independently verified exact front', 'independent positive reference present',
      'warm rankings stable at cohort level'],
    retainedCandidateIdsUnordered: [...arm.top10CardIds].sort((a, b) => a - b),
    candidateEvidence: 'The historical breadth10 reranker permuted exactly the raw DINO top10 pool without filtering. IDs therefore recover pool membership only, NOT DINO order, top1 identity, scores, artwork descriptions or causal similarity.',
    dinoTop1CandidateId: null,
    cause: 'unknown',
    confirmedCauseCategories: [],
    hypothesizedCauseCategories: [],
    evidenceAvailability: 'Photos, vectors, detailed visual QA and original DINO candidate ordering were deleted. Retained QA records certify front identity/reference presence, not imaging conditions or distractor appearance. No case-specific causal visual notes survive in the available sanitized evidence/context.',
  };
});
const report = {
  title: 'Sanitized DINO-only failure audit — retained evidence only',
  sourcePath,
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  newInferenceExecuted: false,
  newImageOrDatabaseAccess: false,
  historicalSourceModified: false,
  sample: {n: 41, top1: 29, top3: 32, top10: 35, top1Misses: 12,
    top10MissesSubsetOfTop1Misses: 6, top1MissesStillWithinTop10: 6},
  interpretation: 'This audits the DINO baseline, not the 13 historical reranker top1 misses. No visual causal category can be faithfully assigned from ranks/IDs alone. Large rank is not proof of intrinsically poor embeddings; acquisition/reference effects remain unobserved.',
  categoryCounts: Object.fromEntries(categories.map(category => [category,
    {confirmedTop1Misses: 0, confirmedTop10Misses: 0, unassessableTop1Misses: 12, unassessableTop10Misses: 6}])),
  countWarning: 'Category unassessable counts overlap; they are not 84 distinct failures. Zero confirmed means absent evidence, not absence of the cause.',
  uniqueCauseCounts: {confirmed: 0, unknown: 12, top10SubsetConfirmed: 0, top10SubsetUnknown: 6},
  limitations: [
    'Prior visual acceptance supports exact front identity, not proof of ideal framing or absence of glare, occlusion, small card area or confusing references.',
    'No independently verified parallel cases were admitted. That does not rule out a variant-like distractor, nor establish ambiguity.',
    'Catalog distractors were not individually visually audited; shared catalog images can create ambiguity, but no particular miss is attributed to this.',
    'Card names/artwork descriptions cannot be recovered from numeric IDs and were not looked up.',
  ],
  minimumMissingLocalEvidence: [
    'For each of the 12 misses: a user-provided local query photo linked to its scan ID and the independent positive reference linked to its card ID.',
    'For each miss: a user-provided local DINO-ordered candidate list (at least top10 IDs/scores) and the corresponding candidate reference images. For ranks beyond10, include the positive and its score/rank as well.',
    'Only where exact-print ambiguity is suspected: local trustworthy printing/variant labels and visible distinguishing-detail evidence. Do not guess from artwork.',
    'Supply local evidence explicitly if a causal review is desired; this audit does not request or authorize any production export, URL fetch, rerun or reconstruction.',
  ],
  nextEvaluation: {baseline: 'canonical-single-image-dino', reranker: false,
    optionalGuidedCrop: false, approvedBoundaryDependence: false,
    policyGuard: 'scripts/dev-dino-next-evaluation.mjs',
    status: 'Policy-only gate. No new image evaluation authorized or executed; historical harnesses preserved, not invoked.'},
  cases,
};
const escape = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const table = rows => `<table><tr><th>Scan / positive card</th><th>DINO rank</th><th>Retained candidate pool (unordered IDs)</th><th>Assessment</th></tr>${rows.map(c => `<tr><td>${c.scanId} / ${c.confirmedCardId}</td><td>${c.dinoRank}</td><td>${c.retainedCandidateIdsUnordered.join(', ')}</td><td>${escape(c.description)} Cause: unknown.</td></tr>`).join('')}</table>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DINO failure audit</title><style>body{font:16px/1.5 system-ui;max-width:1150px;margin:auto;padding:28px;color:#172b3a}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #bbc8d2;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.notice{background:#fff1cc;padding:18px}</style><h1>DINO-only failure audit</h1><p class="notice">41 cases: 29 top1 successes, 12 top1 misses. Six of those 12 also missed top10. <b>0 confirmed visual causes; 12 unknown.</b> No new inference, photo access or database access.</p><p>${escape(report.interpretation)}</p><h2>Six top10 misses (subset, not additional cases)</h2>${table(cases.filter(c => c.top10Miss))}<h2>Other six top1 misses (positive within top10)</h2>${table(cases.filter(c => !c.top10Miss))}<h2>What candidate IDs mean</h2><p>${escape(cases[0].candidateEvidence)}</p><h2>Cause categories</h2><p>All seven requested categories remain unassessable for all12 misses. Each has zero confirmed cases; this is not evidence that the category never occurred. No case-specific hypotheses are asserted without supporting evidence.</p><ul>${categories.map(c => `<li>${escape(c)}: confirmed0; unassessable12 (including all6 top10 misses)</li>`).join('')}</ul><h2>Evidence limits</h2><p>${escape(cases[0].evidenceAvailability)}</p><ul>${report.limitations.map(s => `<li>${escape(s)}</li>`).join('')}</ul><h2>Minimal missing local evidence</h2><ul>${report.minimumMissingLocalEvidence.map(s => `<li>${escape(s)}</li>`).join('')}</ul><h2>Next evaluation constraints</h2><p>DINO alone; no reranker, guided crop, approved-boundary dependence, tuning, production access, database writes, full indexing or publication. The new policy guard defaults to these constraints and rejects overrides; it does not execute inference or alter live matching. Frozen historical files are preserved.</p><details><summary>Sanitized structured audit</summary><pre>${escape(JSON.stringify(report, null, 2))}</pre></details></html>`;
for (const content of [JSON.stringify(report), html]) {
  assert(!/https?:\/\/|data:image|<img\b/.test(content));
}
fs.writeFileSync('attached_assets/dev-dino-failure-audit.json', JSON.stringify(report, null, 2), {mode: 0o600});
fs.writeFileSync('attached_assets/dev-dino-failure-audit.html', html, {mode: 0o600});
assert.equal(createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), report.sourceSha256);
console.log(JSON.stringify({cases: cases.length, top10Subset: 6, confirmedCauses: 0, unknownCauses: 12, inferenceExecuted: false}));
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Development experiment policy only. Historical harnesses are retained for
// provenance, not the entry point for the next evaluation. No live app changes.
export const NEXT_EVALUATION_POLICY = Object.freeze({
  baseline: 'canonical-single-image-dino',
  reranker: false,
  optionalGuidedCrop: false,
  approvedBoundaryDependence: false,
  input: 'user-provided-local-only',
  network: false,
  productionAccess: false,
  databaseWrites: false,
  fullIndex: false,
  tuning: false,
  publication: false,
});

export function assertNextEvaluationPolicy(request = {}) {
  for (const key of Object.keys(request)) {
    assert(Object.hasOwn(NEXT_EVALUATION_POLICY, key), `Unknown evaluation option: ${key}`);
    assert.equal(request[key], NEXT_EVALUATION_POLICY[key], `Forbidden evaluation option: ${key}`);
  }
  return NEXT_EVALUATION_POLICY;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert(process.argv.slice(2).every(arg => arg === '--check'),
    'This policy-only entry point accepts --check; historical reranker/crop harness execution is not authorized.');
  console.log(JSON.stringify({
    policy: assertNextEvaluationPolicy(),
    inferenceExecuted: false,
    nextRunBlocked: 'Deleted production photos must not be reconstructed. Await explicitly supplied local evidence and a DINO-only runner using this guard.',
  }, null, 2));
}
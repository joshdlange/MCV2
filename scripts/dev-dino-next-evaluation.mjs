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

// One explicit execution authorization, not a standing permission to query scans.
export function assertAuthorizedFailureAudit(scanIds) {
  const authorized = [3173,3169,3090,3086,3056,2981,3098,3087,2984,2983,2899,2866].sort((a,b)=>a-b);
  assert.deepEqual([...scanIds].sort((a,b)=>a-b), authorized,
    'This authorization is restricted to exactly the twelve specified scan IDs');
  return Object.freeze({...NEXT_EVALUATION_POLICY,
    input: 'explicit-twelve-scan-read-only-authorization',
    productionAccess: 'SELECT scan ID, original image URL, confirmed card ID only',
    network: 'these twelve originals and bounded catalog references only',
    independentPhotoOnlyDetector: true,
    deleteOwnedTemporaryEvidence: true,
  });
}

export function assertAuthorizedMixedIsolationAudit(scanIds, verifiedHistoricalIds) {
  const authorized=[3173,3169,3108,3104,3100,3098,3097,3090,3087,3086,3078,3056,3014,3012,2984,2983,2981,2969,2965,2950,2939,2910,2909,2906,2903,2902,2901,2900,2899,2871,2869,2866,2838,2836,2835,2826,2825,2824,2823,2813,2790].sort((a,b)=>a-b);
  assert.equal(verifiedHistoricalIds.length,41);
  assert.equal(new Set(verifiedHistoricalIds).size,41);
  assert.deepEqual([...verifiedHistoricalIds].sort((a,b)=>a-b),authorized);
  assert.deepEqual([...scanIds].sort((a,b)=>a-b), [...verifiedHistoricalIds].sort((a,b)=>a-b));
  return Object.freeze({...NEXT_EVALUATION_POLICY,
    input:'explicit-mixed-cohort-read-only-authorization',
    productionAccess:'SELECT scan ID, original image URL, confirmed card ID only; prior41 verified IDs',
    network:'authorized originals and bounded catalog references only',
    independentPhotoOnlyDetector:true,freezeBeforeOutcomes:true,
    deleteOwnedTemporaryEvidence:true,
  });
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
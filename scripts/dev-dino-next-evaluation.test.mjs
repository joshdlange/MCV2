import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXT_EVALUATION_POLICY, assertNextEvaluationPolicy, assertAuthorizedFailureAudit, assertAuthorizedMixedIsolationAudit} from './dev-dino-next-evaluation.mjs';
import fs from 'node:fs';

test('next evaluation defaults are immutable, raw DINO and local only', () => {
  assert(Object.isFrozen(NEXT_EVALUATION_POLICY));
  assert.equal(assertNextEvaluationPolicy().baseline, 'canonical-single-image-dino');
  assert.equal(assertNextEvaluationPolicy().reranker, false);
  assert.equal(assertNextEvaluationPolicy().optionalGuidedCrop, false);
});

test('explicit twelve-scan exception is exact and never enables reranking or guided crops', () => {
  const ids=[3173,3169,3090,3086,3056,2981,3098,3087,2984,2983,2899,2866];
  const policy=assertAuthorizedFailureAudit(ids);
  assert.equal(policy.reranker,false);
  assert.equal(policy.optionalGuidedCrop,false);
  assert.equal(policy.independentPhotoOnlyDetector,true);
  assert.throws(()=>assertAuthorizedFailureAudit([...ids,1]));
  assert.throws(()=>assertAuthorizedFailureAudit(ids.slice(1)));
});

test('mixed cohort exception requires exactly the prior41 verified scan IDs', () => {
  const ids=JSON.parse(fs.readFileSync('attached_assets/dev-broad-readonly-production-results.json')).perCase.map(c=>c.scanId);
  const policy=assertAuthorizedMixedIsolationAudit(ids,ids);
  assert.equal(policy.reranker,false);
  assert.equal(policy.optionalGuidedCrop,false);
  assert.equal(policy.freezeBeforeOutcomes,true);
  assert.throws(()=>assertAuthorizedMixedIsolationAudit(ids.slice(1),ids));
  const arbitrary=Array.from({length:41},(_,i)=>i);
  assert.throws(()=>assertAuthorizedMixedIsolationAudit(arbitrary,arbitrary));
});

test('reject all prohibited experiment overrides and unknown options', () => {
  for (const key of ['reranker', 'optionalGuidedCrop', 'approvedBoundaryDependence',
    'network', 'productionAccess', 'databaseWrites', 'fullIndex', 'tuning', 'publication']) {
    assert.throws(() => assertNextEvaluationPolicy({[key]: true}), /Forbidden/);
  }
  assert.throws(() => assertNextEvaluationPolicy({input: 'production'}), /Forbidden/);
  assert.throws(() => assertNextEvaluationPolicy({baseline: 'reranked'}), /Forbidden/);
  assert.throws(() => assertNextEvaluationPolicy({crop: true}), /Unknown/);
});
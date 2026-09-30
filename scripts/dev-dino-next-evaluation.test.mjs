import test from 'node:test';
import assert from 'node:assert/strict';
import {NEXT_EVALUATION_POLICY, assertNextEvaluationPolicy} from './dev-dino-next-evaluation.mjs';

test('next evaluation defaults are immutable, raw DINO and local only', () => {
  assert(Object.isFrozen(NEXT_EVALUATION_POLICY));
  assert.equal(assertNextEvaluationPolicy().baseline, 'canonical-single-image-dino');
  assert.equal(assertNextEvaluationPolicy().reranker, false);
  assert.equal(assertNextEvaluationPolicy().optionalGuidedCrop, false);
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
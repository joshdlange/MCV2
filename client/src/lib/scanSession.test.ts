import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRefreshScanSessionInPlace as retain } from './scanSession';

test('same verified identity retains enabled dev scan; all trust transitions stay gated', () => {
  assert.equal(retain(true, true, 'verified', 'verified'), true);
  assert.equal(retain(false, true, 'verified', 'verified'), false);
  assert.equal(retain(true, false, 'verified', 'verified'), false);
  assert.equal(retain(true, true, null, 'verified'), false);
  assert.equal(retain(true, true, 'verified', 'different'), false);
  assert.equal(retain(true, true, 'verified', undefined), false);
});
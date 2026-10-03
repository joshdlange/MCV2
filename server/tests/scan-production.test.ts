import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isVisualScanEnabled } from '../scanRuntime';
import { suppressAutomaticCatalogMutations } from '../devCatalogSnapshot';
import { createScanUndoToken, readScanUndoToken } from '../scanUndoToken';

test('production feature switch does not suppress catalog maintenance', () => {
  const env = { NODE_ENV: 'production', REPLIT_DEPLOYMENT: '1', SCAN_VISUAL_RETRIEVAL: 'on' };
  assert.equal(isVisualScanEnabled(env), true);
  assert.equal(suppressAutomaticCatalogMutations(env), false);
  assert.equal(isVisualScanEnabled({ ...env, SCAN_VISUAL_RETRIEVAL: 'off' }), false);
});
test('signed Undo survives instances, rejects tampering, wrong key, expiry and invalid tokens', () => {
  const key = 'test-only-signing-key';
  const entry = { userId: 12, rowId: 34, snapshot: '{"id":34}', expires: Date.now() + 120_000 };
  const token = createScanUndoToken(entry, key);
  assert.deepEqual(readScanUndoToken(token, key), entry);
  assert.equal(readScanUndoToken(token, 'different-test-key'), undefined);
  assert.equal(readScanUndoToken(`x${token}`, key), undefined);
  assert.equal(readScanUndoToken(createScanUndoToken({ ...entry, expires: 1 }, key), key), undefined);
  for (const value of [null, {}, '', 'x.y', 'x.y.z', 'x'.repeat(40_000)]) {
    assert.equal(readScanUndoToken(value, key), undefined);
  }
});
test('release DDL is creation-only and does not change existing tables', () => {
  const source = readFileSync('server/scanSchema.ts', 'utf8');
  assert.doesNotMatch(source, /^\s*(?:ALTER|DROP|DELETE|TRUNCATE|UPDATE)\s/im);
  assert.equal((source.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length, 5);
});
test('packaged scanner has no .local or dev database requirement', () => {
  assert.doesNotMatch(readFileSync('server/scanRuntime.ts', 'utf8'), /\.local|devDataPath/);
  assert.doesNotMatch(readFileSync('server/services/devScanTelemetry.ts', 'utf8'), /helium|hostname|suppressAutomaticCatalogMutations/);
});
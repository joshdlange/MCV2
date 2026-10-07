import test from 'node:test';
import assert from 'node:assert/strict';
import { retryCatalogTransaction } from '../seeds/retryCatalogTransaction';

test('retries the whole operation after a deadlock or wrapped serialization failure', async () => {
  let attempts = 0;
  const waits: number[] = [];
  await retryCatalogTransaction(async () => {
    attempts++;
    if (attempts === 1) throw { code: '40P01' };
    if (attempts === 2) throw { cause: { code: '40001' } };
  }, async ms => { waits.push(ms); });
  assert.equal(attempts, 3);
  assert.equal(waits.length, 2);
});

test('never retries identity failures and propagates exhausted deadlocks', async () => {
  let attempts = 0;
  const failure = new Error('invalid identity');
  await assert.rejects(retryCatalogTransaction(async () => {
    attempts++;
    throw failure;
  }, async () => {}), error => error === failure);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(retryCatalogTransaction(async () => {
    attempts++;
    throw Object.assign(new Error('deadlock'), { code: '40P01' });
  }, async () => {}), /deadlock/);
  assert.equal(attempts, 4);
});

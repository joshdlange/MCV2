import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogReadCache } from '../catalogReadCache';
import { warmDatabaseConnections, retryStartupDatabase } from '../startupDatabase';
import { catalogQueryOptions } from '../../client/src/lib/catalogQueryOptions';

test('catalog polling is reduced and refresh remains available', () => {
  assert.equal(catalogQueryOptions.refetchInterval, 300_000);
  assert.equal(catalogQueryOptions.refetchOnWindowFocus, true);
  assert.equal(catalogQueryOptions.refetchIntervalInBackground, false);
});

test('warmup releases connections when another connect fails', async () => {
  let acquired = 0, released = 0;
  const failures = await warmDatabaseConnections({ async connect() {
    if (++acquired === 2) throw Error('connect failure');
    return { async query() {}, release() { released++; } };
  } });
  assert.equal(failures, 1);
  assert.equal(released, 2);
});

test('warmup releases every connection on query failure', async () => {
  let released = 0;
  assert.equal(await warmDatabaseConnections({ async connect() {
    return { async query() { throw Error('query failure'); }, release() { released++; } };
  } }), 3);
  assert.equal(released, 3);
});

test('startup retries transient failures and remains fail-closed', async () => {
  let calls = 0;
  assert.equal(await retryStartupDatabase(async () => {
    if (++calls < 3) throw Object.assign(Error('unavailable'), { code: 'ECONNRESET' });
    return 'ready';
  }, async () => {}), 'ready');
  calls = 0;
  await assert.rejects(retryStartupDatabase(async () => {
    calls++;
    throw Error('invalid schema');
  }, async () => {}), /invalid schema/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(retryStartupDatabase(async () => {
    calls++;
    throw Error('Connection terminated due to connection timeout');
  }, async () => {}), /connection timeout/);
  assert.equal(calls, 3);
});

test('catalog cache coalesces, expires and invalidates', async () => {
  let now = 0, calls = 0;
  const cache = createCatalogReadCache(15, () => now);
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('sets', load), cache.get('sets', load)]), [1, 1]);
  assert.equal(await cache.get('sets', load), 1);
  now = 16;
  assert.equal(await cache.get('sets', load), 2);
  cache.invalidate();
  assert.equal(await cache.get('sets', load), 3);
});

test('catalog errors are never cached and invalidated inflight reads cannot refill cache', async () => {
  const cache = createCatalogReadCache();
  await assert.rejects(cache.get('sets', async () => { throw Error('database down'); }));
  assert.equal(await cache.get('sets', async () => 1), 1);
  let finish!: (value: number) => void;
  const pending = cache.get('other', () => new Promise<number>(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.invalidate();
  finish(2);
  await pending;
  assert.equal(await cache.get('other', async () => 3), 3);
});

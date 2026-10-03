import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertDevScanTelemetryDatabase, DevScanTelemetryWriter, initializeDevScanTelemetry,
  validateDevScanEventPatch, type DevScanTelemetryDatabase, DevScanTelemetryError,
} from '../services/devScanTelemetry';

const env = {
  NODE_ENV: 'development', SCAN_VISUAL_RETRIEVAL: 'on',
  DATABASE_URL: 'postgresql://dev:password@helium/heliumdb',
};
const id = '11111111-1111-4111-8111-111111111111';
test('DDL and every writer operation guard strict DEV flag and exact Helium target before connecting', async () => {
  for (const bad of [
    { ...env, NODE_ENV: 'production' }, { ...env, REPLIT_DEPLOYMENT: '1' },
    { ...env, SCAN_VISUAL_RETRIEVAL: 'off' }, { ...env, DATABASE_URL: '' },
    { ...env, DATABASE_URL: 'postgresql://dev:password@helium/production' },
    { ...env, DATABASE_URL: 'postgresql://dev:password@production/heliumdb' },
    { ...env, DATABASE_URL: 'postgresql://dev:password@helium.example.com/heliumdb' },
  ]) {
    let connections = 0;
    const writer = new DevScanTelemetryWriter(bad, async () => {
      connections++; throw new Error('must not connect');
    });
    assert.throws(() => assertDevScanTelemetryDatabase(bad));
    await assert.rejects(writer.initialize());
    await assert.rejects(writer.begin(42));
    await assert.rejects(writer.finish(id, 42, { status: 'error', topScore: null, margin: null, serverMs: 1 }));
    await assert.rejects(writer.patch(id, 42, { totalMs: 1 }));
    assert.equal(connections, 0);
  }
  // The startup hook is inert off/prod even without a database URL.
  await initializeDevScanTelemetry({ NODE_ENV: 'production' });
  await initializeDevScanTelemetry({ ...env, SCAN_VISUAL_RETRIEVAL: 'off' });
  assert.doesNotThrow(() => assertDevScanTelemetryDatabase(env));
});
test('photo-free DDL is separate from shared schema, and request writes never lazily create schema', async () => {
  const queries: { text: string; values?: unknown[] }[] = [];
  const database: DevScanTelemetryDatabase = {
    query: async (text, values) => { queries.push({ text, values }); return { rows: [{ id }] }; },
  };
  const writer = new DevScanTelemetryWriter(env, async () => database);
  await writer.initialize();
  assert.match(queries[0].text, /CREATE TABLE IF NOT EXISTS dev_scan_events/);
  assert.doesNotMatch(queries[0].text, /image|url|filename|ocr|base64|json|request/i);
  assert.doesNotMatch(readFileSync('shared/schema.ts', 'utf8'), /dev_scan_events/);
  queries.length = 0;
  const created = await writer.begin(42);
  assert.match(created, /^[0-9a-f-]{36}$/);
  await writer.finish(created, 42, { status: 'success', topScore: 0.8, margin: 0.2, serverMs: 100, rankedCardIds: [31, 22] });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].values, [created, 42]);
  assert.deepEqual(queries[1].values, [created, 42, 'success', 0.8, 0.2, 100, '[31,22]']);
  assert.match(queries[1].text, /WHERE id = \$1 AND user_id = \$2/);
  assert.ok(queries.every(q => !q.text.includes('CREATE')));
});
test('missing insert/update rows fail explicitly rather than silently dropping telemetry', async () => {
  const writer = new DevScanTelemetryWriter(env, async () => ({ query: async () => ({ rows: [] }) }));
  await assert.rejects(writer.begin(42), /not created/);
  await assert.rejects(writer.finish(id, 42, { status: 'error', topScore: null, margin: null, serverMs: 1 }), /missing/);
  await assert.rejects(writer.patch(id, 42, { totalMs: 1 }), (error: unknown) =>
    error instanceof DevScanTelemetryError && error.statusCode === 404);
});
test('PATCH SQL uses owner filters, active DEV cards, monotonic booleans, first duration, and changeable selection', async () => {
  const queries: { text: string; values?: unknown[] }[] = [];
  const writer = new DevScanTelemetryWriter(env, async () => ({
    query: async (text, values) => { queries.push({ text, values }); return { rows: [{ id }] }; },
  }));
  for (const patch of [
    { pickedCardId: 12, usedSearch: true, photoSubmitUsed: true, totalMs: 123.4 },
    { pickedCardId: 13, usedSearch: false, photoSubmitUsed: false, totalMs: 999 },
    { pickedCardId: null },
  ]) await writer.patch(id, 42, patch);
  const updates = queries.filter(q => q.text.includes('UPDATE'));
  assert.equal(updates.length, 3);
  for (const { text, values } of updates) {
    assert.match(text, /WHERE id = \$1 AND user_id = \$2/);
    assert.match(text, /used_search = used_search OR/);
    assert.match(text, /photo_submit_used = photo_submit_used OR/);
    assert.match(text, /total_ms = COALESCE\(total_ms,/);
    assert.match(text, /picked_card_id = CASE WHEN/);
    assert.match(text, /c.archived_at IS NULL/);
    assert.match(text, /cs.archived_at IS NULL AND cs.is_active = true/);
    assert.match(text, /ms.archived_at IS NULL AND ms.is_active = true/);
    assert.deepEqual(values?.slice(0, 2), [id, 42]);
  }
  assert.deepEqual(updates[0].values?.slice(2), [true, 12, true, true, 123.4]);
  assert.deepEqual(updates[1].values?.slice(2), [true, 13, false, false, 999]);
  assert.deepEqual(updates[2].values?.slice(2), [true, null, false, false, null]);
});
test('invalid or inactive selection is rejected rather than written', async () => {
  let queries = 0;
  const writer = new DevScanTelemetryWriter(env, async () => ({
    query: async () => ({ rows: ++queries === 1 ? [{ id }] : [] }),
  }));
  await assert.rejects(writer.patch(id, 42, { pickedCardId: 999 }), (error: unknown) =>
    error instanceof DevScanTelemetryError && error.statusCode === 400);
});
test('timing must be finite and bounded, with scalar strict allowlist', () => {
  for (const totalMs of [NaN, Infinity, -Infinity, -1, 1800001, null, '1']) {
    assert.throws(() => validateDevScanEventPatch({ totalMs }));
  }
  for (const totalMs of [0, 123.456, 1800000]) {
    assert.deepEqual(validateDevScanEventPatch({ totalMs }), { totalMs });
  }
  assert.throws(() => validateDevScanEventPatch({ pickedCardId: 2147483648 }));
  assert.throws(() => validateDevScanEventPatch({ totalMs: 0, photo: 'private' }));
});
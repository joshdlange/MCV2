import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import sharp from 'sharp';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  registerDevScanRoutes, reserveDevScanQuota, DEV_SCAN_MAX_BYTES,
  type DevScanRouteDependencies,
} from '../devScanRoutes';
import type { DevScanVisualResult } from '../services/devScanVisual';
import {
  DevScanTelemetryError, type DevScanTelemetry, type DevScanEventPatch, type DevScanEventOutcome,
} from '../services/devScanTelemetry';

const env = { NODE_ENV: 'development', SCAN_VISUAL_RETRIEVAL: 'on' };
const eventId = '11111111-1111-4111-8111-111111111111';
// Explicitly injected test-only writer; production defaults to the real writer.
const noopTelemetry: DevScanTelemetry = {
  begin: async () => eventId, finish: async () => {}, patch: async () => {},
};
const result: DevScanVisualResult = {
  matches: [],
  families: [], topScore: null, margin: null,
  timings: { queueMs: 1, cropMs: 2, embeddingMs: 3, searchMs: 4, totalMs: 10 },
};
const auth: RequestHandler = (req, res, next) => {
  if (req.headers.authorization !== 'Bearer valid') {
    res.status(401).json({ message: 'Denied' });
    return;
  }
  (req as typeof req & { user: unknown }).user = { id: 42, plan: 'SIDE_KICK' };
  next();
};
const photo = () => sharp({
  create: { width: 20, height: 30, channels: 3, background: '#777' },
}).png().toBuffer();

async function fixture(
  dependencies: DevScanRouteDependencies,
  authentication: RequestHandler = auth,
) {
  const app = express();
  app.use(express.json());
  let legacyCalls = 0;
  registerDevScanRoutes(app, authentication, { env, telemetry: noopTelemetry, ...dependencies });
  app.post('/api/cards/scan', express.raw({ type: '*/*', limit: '12mb' }), (req, res) => {
    legacyCalls++;
    res.json({ legacy: true, bytes: req.body.length });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base, legacyCalls: () => legacyCalls,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
function multipart(bytes: Buffer, mime = 'image/png', name = 'image') {
  const body = new FormData();
  body.append(name, new Blob([new Uint8Array(bytes)], { type: mime }), 'private-photo.png');
  return body;
}
async function post(base: string, body: FormData, authorized = true) {
  return fetch(`${base}/api/cards/scan`, {
    method: 'POST', body, headers: authorized ? { Authorization: 'Bearer valid' } : {},
  });
}

test('config is public, strictly gated, and flag-off delegates the untouched request to legacy', async () => {
  for (const disabled of [
    { ...env, SCAN_VISUAL_RETRIEVAL: 'off' },
    { ...env, NODE_ENV: 'production' },
    { ...env, REPLIT_DEPLOYMENT: '1' },
  ]) {
    const f = await fixture({
      env: disabled, scan: async () => { throw new Error('must not infer'); },
      reserveQuota: async () => { throw new Error('must not reserve'); },
    }, () => { throw new Error('DEV auth must not run when off'); });
    try {
      const config = await fetch(`${f.base}/api/cards/scan/config`);
      assert.equal(config.status, 200);
      assert.equal(config.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await config.json(), { visualV1: false });
      const body = 'untouched multipart body';
      const response = await fetch(`${f.base}/api/cards/scan`, {
        method: 'POST', body, headers: { 'Content-Type': 'multipart/form-data; boundary=broken' },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { legacy: true, bytes: body.length });
      assert.equal(f.legacyCalls(), 1);
    } finally { await f.close(); }
  }
});

test('authentication denial precedes multipart validation, quota, and inference', async () => {
  let calls = 0;
  const f = await fixture({
    reserveQuota: async () => { calls++; return true; },
    scan: async () => { calls++; return result; },
  });
  try {
    assert.deepEqual(await (await fetch(`${f.base}/api/cards/scan/config`)).json(), { visualV1: true });
    const response = await post(f.base, multipart(Buffer.from('invalid'), 'application/pdf'), false);
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
    assert.equal(f.legacyCalls(), 0);
  } finally { await f.close(); }
});

test('front-only upload rejects missing/extra files, fields, MIME spoofing, corrupt bytes, and oversize before quota', async () => {
  let calls = 0;
  const f = await fixture({
    reserveQuota: async () => { calls++; return true; },
    scan: async () => { calls++; return result; },
  });
  try {
    const image = await photo();
    const backOnly = multipart(image, 'image/png', 'backImage');
    const twoFiles = multipart(image);
    twoFiles.append('backImage', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'back.png');
    const duplicate = multipart(image);
    duplicate.append('image', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'second.png');
    const fields = multipart(image);
    fields.append('userId', '1');
    for (const body of [
      new FormData(), backOnly, twoFiles, duplicate, fields,
      multipart(image, 'application/pdf'),
      multipart(image, 'image/jpeg'), // Declared JPEG but PNG bytes.
      multipart(Buffer.from('private corrupt contents')),
      multipart(Buffer.alloc(DEV_SCAN_MAX_BYTES + 1)),
    ]) {
      assert.equal((await post(f.base, body)).status, 400);
    }
    assert.equal(calls, 0);
    assert.equal(f.legacyCalls(), 0);
  } finally { await f.close(); }
});

test('success uses the injected service and preserves families without storing the uploaded photo', async () => {
  const image = await photo();
  const match = {
    cardId: 12, name: 'Card', cardNumber: '1', setName: 'Set', subsetName: null,
    year: 2026, imageUrl: null, confidence: 70, confidenceLevel: 'medium' as const,
    matchReasons: ['Visual similarity'], familyKey: 'family',
  };
  const serviceResult: DevScanVisualResult = {
    ...result, matches: [match],
    families: [{ familyKey: 'family', representativeCardId: 12, score: 0.7, options: [match] }],
    topScore: 0.7, margin: 0.1,
  };
  const sequence: string[] = [];
  const f = await fixture({
    reserveQuota: async user => {
      assert.deepEqual(user, { id: 42, plan: 'SIDE_KICK' });
      sequence.push('reserve'); return true;
    },
    scan: async buffer => {
      assert.deepEqual(buffer, image);
      sequence.push('scan'); return serviceResult;
    },
  });
  try {
    const response = await post(f.base, multipart(image));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mode, 'visual-v1');
    assert.equal(data.scanEventId, eventId);
    assert.equal(data.imageUrl, null);
    assert.equal(data.scanUploadId, null);
    assert.equal(data.ocrText, '');
    assert.equal(data.confidenceLevel, 'low'); // Raw similarity is not calibrated.
    assert.deepEqual(data.families, serviceResult.families);
    assert.deepEqual(data.matches, serviceResult.matches);
    assert.deepEqual(data.timings, result.timings);
    assert.equal(data.topScore, 0.7);
    assert.equal(data.margin, 0.1);
    assert.deepEqual(data.parsed, {
      characterName: null, setName: null, subsetName: null, cardNumber: null,
      normalizedCardNumber: null, year: null, brand: null, variant: null,
      setCandidates: [], keywords: [],
    });
    assert.deepEqual(sequence, ['reserve', 'scan']);
    assert.equal(f.legacyCalls(), 0);
  } finally { await f.close(); }
});

test('empty results abstain, quota exhaustion prevents inference, and failures are generic without PII logging', async () => {
  for (const mode of ['empty', 'quota', 'inference-error', 'quota-error']) {
    let reservations = 0, scans = 0;
    const logs: unknown[][] = [];
    const f = await fixture({
      reserveQuota: async () => {
        reservations++;
        if (mode === 'quota-error') throw new Error('private database detail');
        return mode !== 'quota';
      },
      scan: async () => {
        scans++;
        if (mode === 'inference-error') throw new Error('private filename / user identifier');
        return result;
      },
      logError: (...args) => { logs.push(args); },
    });
    try {
      const response = await post(f.base, multipart(await photo()));
      const data = await response.json();
      assert.equal(reservations, 1);
      assert.equal(response.status, mode === 'empty' ? 200 : mode === 'quota' ? 429 : 500);
      assert.equal(scans, mode === 'empty' || mode === 'inference-error' ? 1 : 0);
      if (mode === 'empty') assert.equal(data.confidenceLevel, 'none');
      if (mode === 'quota') assert.deepEqual({ limit: data.limit, limitReached: data.limitReached }, { limit: 25, limitReached: true });
      if (mode.endsWith('error')) {
        assert.deepEqual(data, {
          message: 'Scan failed. Please try again.',
          ...(mode === 'inference-error' ? { scanEventId: eventId } : {}),
        });
        assert.deepEqual(logs, [[]]); // No error/request payload given to logger.
      }
      assert.equal(f.legacyCalls(), 0);
    } finally { await f.close(); }
  }
});

test('quota helper locks per user in the same transaction as count and reservation; concurrent final slot admits one', async () => {
  const dialect = new PgDialect();
  let used = 24, tail = Promise.resolve();
  const events: string[] = [];
  const database = {
    transaction: async (callback: (tx: unknown) => Promise<boolean>) => {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      events.push('begin');
      try {
        return await callback({
          execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
            const compiled = dialect.sqlToQuery(query);
            assert.match(compiled.sql, /pg_advisory_xact_lock/);
            assert.deepEqual(compiled.params, [42]);
            events.push('lock');
          },
          select: () => ({ from: () => ({ where: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
            const compiled = dialect.sqlToQuery(query);
            assert.equal(compiled.params[0], 42);
            assert.equal(new Date(compiled.params[1] as string).getDate(), 1);
            events.push('count'); return [{ used }];
          } }) }),
          insert: (table: unknown) => {
            assert.ok(table);
            return { values: async (value: unknown) => {
              assert.deepEqual(value, { userId: 42 });
              events.push('reserve'); used++;
            } };
          },
        });
      } finally { events.push('commit'); release(); }
    },
  } as unknown as NonNullable<Parameters<typeof reserveDevScanQuota>[1]>;
  const user = { id: 42, plan: 'SIDE_KICK' };
  const quotaEnv = { ...env, DATABASE_URL: 'postgresql://dev:password@helium/heliumdb' };
  assert.deepEqual(await Promise.all([
    reserveDevScanQuota(user, database, new Date(), quotaEnv),
    reserveDevScanQuota(user, database, new Date(), quotaEnv),
  ]), [true, false]);
  assert.equal(used, 25);
  assert.deepEqual(events, ['begin', 'lock', 'count', 'reserve', 'commit', 'begin', 'lock', 'count', 'commit']);
  events.length = 0;
  assert.equal(await reserveDevScanQuota({ ...user, plan: 'SUPER_HERO' }, database, new Date(), quotaEnv), true);
  assert.deepEqual(events, ['begin', 'lock', 'reserve', 'commit']);
});

test('normal route wires DEV branch before legacy multipart; branch has no persistence/OCR dependencies', () => {
  const routes = readFileSync('server/routes.ts', 'utf8');
  assert.ok(routes.indexOf('registerDevScanRoutes(app, authenticateUser)') < routes.indexOf('app.post("/api/cards/scan"'));
  const source = readFileSync('server/devScanRoutes.ts', 'utf8');
  assert.doesNotMatch(source, /uploadImage|createScanUpload|scanCard\(|cloudinary|scanUploads|writeFile/);
  assert.match(source, /next\('route'\)/);
});

function trackedTelemetry(owner = 42) {
  const outcomes: DevScanEventOutcome[] = [];
  const patches: DevScanEventPatch[] = [];
  let begins = 0;
  const telemetry: DevScanTelemetry = {
    begin: async userId => { assert.equal(userId, 42); begins++; return eventId; },
    finish: async (id, userId, outcome) => {
      assert.equal(id, eventId); assert.equal(userId, 42); outcomes.push(outcome);
    },
    patch: async (id, userId, patch) => {
      if (id !== eventId || userId !== owner) throw new DevScanTelemetryError(404, 'Scan event not found');
      if (patch.pickedCardId === 999) throw new DevScanTelemetryError(400, 'pickedCardId must identify an active DEV card');
      patches.push(patch);
    },
  };
  return { telemetry, outcomes, patches, begins: () => begins };
}
async function patchEvent(base: string, body: unknown, id = eventId, authorized = true) {
  return fetch(`${base}/api/cards/scan/events/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer valid' } : {}) },
  });
}
test('every admitted scan begins metadata before inference, and inference failure finishes error', async () => {
  for (const fails of [false, true]) {
    const tracked = trackedTelemetry();
    const f = await fixture({
      telemetry: tracked.telemetry, reserveQuota: async () => true,
      scan: async () => {
        assert.equal(tracked.begins(), 1);
        if (fails) throw new Error('private image detail');
        return { ...result, topScore: 0.8, margin: 0.2 };
      }, logError: () => {},
    });
    try {
      const response = await post(f.base, multipart(await photo()));
      assert.equal(response.status, fails ? 500 : 200);
      assert.equal((await response.json()).scanEventId, eventId);
      assert.equal(tracked.outcomes.length, 1);
      assert.equal(tracked.outcomes[0].status, fails ? 'error' : 'success');
      assert.equal(tracked.outcomes[0].topScore, fails ? null : 0.8);
      assert.equal(tracked.outcomes[0].margin, fails ? null : 0.2);
      assert.ok(tracked.outcomes[0].serverMs >= 0);
    } finally { await f.close(); }
  }
});
test('telemetry begin and finish failures are explicit and never return a successful scan', async () => {
  for (const failAt of ['begin', 'finish']) {
    let scans = 0;
    const f = await fixture({
      reserveQuota: async () => true, logError: () => {},
      scan: async () => { scans++; return result; },
      telemetry: {
        ...noopTelemetry,
        begin: async () => { if (failAt === 'begin') throw new Error('private DB detail'); return eventId; },
        finish: async () => { throw new Error('private DB detail'); },
      },
    });
    try {
      const response = await post(f.base, multipart(await photo()));
      assert.equal(response.status, 500);
      assert.equal((await response.json()).message, 'Scan telemetry logging failed. Please try again.');
      assert.equal(scans, failAt === 'begin' ? 0 : 1);
    } finally { await f.close(); }
  }
});
test('PATCH requires auth and ownership, validates IDs and allowlisted scalar fields, and permits timing updates', async () => {
  const tracked = trackedTelemetry();
  const f = await fixture({ telemetry: tracked.telemetry });
  try {
    assert.equal((await patchEvent(f.base, { totalMs: 123 }, eventId, false)).status, 401);
    assert.equal((await patchEvent(f.base, { totalMs: 123 }, 'bad-id')).status, 400);
    assert.equal((await patchEvent(f.base, { totalMs: 123 }, '22222222-2222-4222-8222-222222222222')).status, 404);
    for (const body of [
      {}, [], null, { imageUrl: 'private' }, { ocrText: 'private' }, { userId: 1 },
      { status: 'success' }, { topScore: 1 }, { totalMs: -1 }, { totalMs: 1800001 },
      { totalMs: '123' }, { usedSearch: 1 }, { photoSubmitUsed: 'true' },
      { pickedCardId: 0 }, { pickedCardId: 1.5 }, { pickedCardId: 999 },
      { totalMs: 123, filename: 'private' },
    ]) assert.equal((await patchEvent(f.base, body)).status, 400);
    const body = { totalMs: 123.4, usedSearch: true, photoSubmitUsed: false, pickedCardId: 12 };
    const response = await patchEvent(f.base, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { scanEventId: eventId, updated: true });
    assert.equal((await patchEvent(f.base, { pickedCardId: null, totalMs: 0 })).status, 200);
    assert.deepEqual(tracked.patches, [body, { pickedCardId: null, totalMs: 0 }]);
  } finally { await f.close(); }
  const otherOwner = await fixture({ telemetry: trackedTelemetry(1).telemetry });
  try { assert.equal((await patchEvent(otherOwner.base, { totalMs: 123 })).status, 404); }
  finally { await otherOwner.close(); }
});
test('PATCH is a 404 when flag off or not strictly DEV, without auth or telemetry work', async () => {
  for (const disabled of [
    { ...env, SCAN_VISUAL_RETRIEVAL: 'off' }, { ...env, NODE_ENV: 'production' },
    { ...env, REPLIT_DEPLOYMENT: '1' },
  ]) {
    const f = await fixture({
      env: disabled, telemetry: { ...noopTelemetry, patch: async () => { throw new Error('must not write'); } },
    }, () => { throw new Error('must not authenticate'); });
    try { assert.equal((await patchEvent(f.base, { totalMs: 0 })).status, 404); }
    finally { await f.close(); }
  }
});
test('PATCH persistence errors surface explicitly without raw error details', async () => {
  const f = await fixture({
    logError: () => {}, telemetry: { ...noopTelemetry, patch: async () => { throw new Error('secret DB error'); } },
  });
  try {
    const response = await patchEvent(f.base, { usedSearch: true });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Scan telemetry update failed. Please try again.' });
  } finally { await f.close(); }
});
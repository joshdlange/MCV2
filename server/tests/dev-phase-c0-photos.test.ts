import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';

process.env.DATABASE_URL ||= 'postgres://unused:unused@localhost:5432/unused';
const savedEnv = process.env.NODE_ENV;
const { registerPhaseC0PhotoRoutes } = await import('../dev-phase-c0-photos');

async function serve(env: string, isAdmin = true) {
  process.env.NODE_ENV = env;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-c0-'));
  const app = express();
  app.use(express.json());
  registerPhaseC0PhotoRoutes(app, (req: any, _res, next) => { req.user = { isAdmin }; next(); }, { root });
  process.env.NODE_ENV = savedEnv;
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/admin/phase-c0`;
  return { root, url, close: () => server.close() };
}
const photo = () => sharp({ create: { width: 300, height: 400, channels: 3, background: '#777777' } }).jpeg().toBuffer();
const form = async (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('photo', new Blob([await photo()], { type: 'image/jpeg' }), 'p.jpg');
  return f;
};

test('routes do not exist outside development', async () => {
  const s = await serve('production');
  try { assert.equal((await fetch(s.url)).status, 404); } finally { s.close(); }
});

test('non-admin is refused', async () => {
  const s = await serve('development', false);
  process.env.NODE_ENV = 'development';
  try { assert.equal((await fetch(s.url)).status, 403); } finally { s.close(); process.env.NODE_ENV = savedEnv; }
});

test('single and binder uploads save original bytes and labels; corners ordered; remove deletes', async () => {
  const s = await serve('development');
  process.env.NODE_ENV = 'development';
  try {
    const single = await fetch(s.url, { method: 'POST', body: await form({ kind: 'single', cardId: '19270', tags: '["sleeve","glare"]' }) });
    assert.equal(single.status, 200);
    const one = await single.json();
    assert.equal(one.cardId, 19270);
    assert.deepEqual(one.tags, ['sleeve', 'glare']);
    assert.equal((await fs.readFile(path.join(s.root, one.file))).length, (await photo()).length);

    assert.equal((await fetch(s.url, { method: 'POST', body: await form({ kind: 'single', cardId: 'abc' }) })).status, 400);
    assert.equal((await fetch(s.url, { method: 'POST', body: await form({ kind: 'single', cardId: '5', tags: '["bogus"]' }) })).status, 400);

    const cells = JSON.stringify([1, 2, 3, null, 5, 6, 7, 8, null]);
    const binder = await (await fetch(s.url, { method: 'POST', body: await form({ kind: 'binder', cells }) })).json();
    assert.deepEqual(binder.cells, [1, 2, 3, null, 5, 6, 7, 8, null]);
    assert.equal(binder.pageCorners, undefined);
    // Reading-order clicks are reordered clockwise; cells survive a corners-only update.
    const put = await fetch(`${s.url}/${binder.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageCorners: [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] }) });
    const updated = await put.json();
    assert.deepEqual(updated.pageCorners, [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
    assert.deepEqual(updated.cells, binder.cells);

    const preview = await fetch(`${s.url}/image/${binder.id}`);
    assert.equal(preview.headers.get('content-type'), 'image/jpeg');

    const list = await (await fetch(s.url)).json();
    assert.equal(list.items.length, 2);
    assert.equal((await fetch(`${s.url}/${one.id}`, { method: 'DELETE' })).status, 200);
    await assert.rejects(fs.access(path.join(s.root, one.file)));
    assert.equal((await (await fetch(s.url)).json()).items.length, 1);
  } finally { s.close(); process.env.NODE_ENV = savedEnv; }
});

test('catalog search: words must all match name/set/number (read-only dev catalog)', {
  skip: !process.env.DATABASE_URL?.includes('@helium') && 'dev catalog (helium) needed',
}, async () => {
  const s = await serve('development');
  process.env.NODE_ENV = 'development';
  try {
    assert.deepEqual(await (await fetch(`${s.url}/search?q=a`)).json(), []);
    const rows = await (await fetch(`${s.url}/search?q=${encodeURIComponent('rogue 146')}`)).json();
    assert.ok(rows.length > 0 && rows.length <= 30);
    assert.ok(rows.every((r: any) => /rogue/i.test(r.name + r.setName) && /^#?0*146$/.test(String(r.cardNumber)) || /146/.test(r.name + r.setName)));
    assert.ok(rows.some((r: any) => r.id === 20279), 'known Rogue #146 record is found');
  } finally { s.close(); process.env.NODE_ENV = savedEnv; }
});

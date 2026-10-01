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

test('search and lookup read the frozen production snapshot file (no database)', async () => {
  const s = await serve('development');
  process.env.NODE_ENV = 'development';
  try {
    const card = (id: number, name: string, cardNumber: string, setName: string, extra = {}) => ({ id, name, cardNumber, variation: null,
      setId: 1, setName, year: 1995, mainSetId: 1, mainSetName: setName, setActive: true, archived: false,
      imageUrl: `https://res.cloudinary.com/x/image/upload/v1/${id}.jpg`, ...extra });
    await fs.mkdir(path.join(s.root, 'prod-catalog'), { recursive: true });
    await fs.writeFile(path.join(s.root, 'prod-catalog', 'cards.json'), JSON.stringify({ cards: [
      card(548422, 'Sentry', '79', 'Base'),
      card(20279, 'Rogue', '146', '1995 Fleer Ultra X-Men'),
      card(530526, 'Rogue', '146', '1995 Fleer Ultra X-Men', { archived: true }),
      card(7, 'Rogue', '14', '1995 Fleer Ultra X-Men'),
    ] }));
    assert.deepEqual(await (await fetch(`${s.url}/search?q=a`)).json(), []);
    const rogue = await (await fetch(`${s.url}/search?q=${encodeURIComponent('rogue #0146')}`)).json();
    assert.deepEqual(rogue.map((r: any) => r.id), [20279, 530526]); // number match, active first
    assert.equal(rogue[1].archivedAt, 'archived');
    const sentry = await (await fetch(`${s.url}/card/548422`)).json();
    assert.equal(sentry.name, 'Sentry');
    assert.match(sentry.imageUrl, /548422/);
    assert.equal((await fetch(`${s.url}/card/999`)).status, 404);
  } finally { s.close(); process.env.NODE_ENV = savedEnv; }
});

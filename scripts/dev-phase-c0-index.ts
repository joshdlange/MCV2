// DEV-ONLY Phase C0 full-catalog visual index builder (docs/scan-plan-phase-c0.md §6, option 1).
// Originals only, single-image inference, two variants (current processor, crop fix).
// Writes .local/phase-c0/index-full only. Reads the dev catalog read-only. No database writes.
// Modes:
//   manifest                    freeze the eligible URL list (+ card IDs) from the dev catalog
//   worker <i> <n> [--limit=K]  embed items with index % n == i (and index < K), resumable
//   status                      progress, failure rate and projected total
//   assemble                    merge worker shards into ordered full arrays
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { embedCatalogVisualImage, normalizeVisualVector, bundledVisualModelPath, MODEL_REVISION, MODEL_VERSION } from '../server/services/catalogVisualModel';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
import { CATALOG, ELIGIBLE } from '../server/services/catalogVisual';
import { devDataPath } from '../server/devData';

process.umask(0o077);
process.env.CATALOG_VISUAL_OFFLINE = 'true';
const [mode, ...args] = process.argv.slice(2);
// --run=prod (addendum): production catalog of record; reuses vectors from the dev-manifest run by URL.
const PROD = args.includes('--run=prod');
const DEV_RUN = devDataPath('phase-c0/index-full');
const OUT = PROD ? devDataPath('phase-c0/index-prod') : DEV_RUN;
const MANIFEST = PROD ? devDataPath('phase-c0/prod-catalog/manifest.json') : path.join(DEV_RUN, 'manifest.json');
const CACHE = devDataPath('phase-c0/catalog-cache');
const DIM = 384, BYTES = DIM * 4;
const MAX_CONCURRENT_TOTAL = 4, MAX_RPS_TOTAL = 10, ATTEMPTS = 5;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));

// Same crop-fix embedding as scripts/dev-phase-b.ts (processor resize/center-crop off).
let fixPipe: any;
async function embedFixed(buffer: Buffer): Promise<number[]> {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers');
  if (!fixPipe) {
    env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false;
    fixPipe = await pipeline('image-feature-extraction', bundledVisualModelPath(), {
      revision: MODEL_REVISION, device: 'cpu', dtype: 'q8', local_files_only: true,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
    const processor = fixPipe.processor.image_processor ?? fixPipe.processor;
    processor.do_resize = false; processor.do_center_crop = false;
  }
  const { data, info } = await sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate().resize(224, 224, { fit: 'contain', background: '#777777' })
    .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const output = await fixPipe(new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3));
  assert.deepEqual(output.dims, [1, 257, DIM]);
  return normalizeVisualVector(output.data.slice(0, DIM));
}

type Entry = { url: string; cardIds: number[] };

if (mode === 'manifest') {
  await fs.mkdir(OUT, { recursive: true });
  assert(!PROD, 'the production manifest comes from scripts/dev-phase-c0-prod-snapshot.ts');
  const target = MANIFEST;
  assert(!existsSync(target), 'manifest already frozen');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c default_transaction_read_only=on' });
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'helium', 'dev catalog only');
  await c.connect();
  const { rows } = await c.query(`SELECT c.front_image_url AS url, array_agg(c.id ORDER BY c.id) AS "cardIds"
    ${CATALOG} WHERE ${ELIGIBLE} GROUP BY c.front_image_url ORDER BY min(c.id)`);
  await c.end();
  const entries: Entry[] = rows;
  await fs.writeFile(target, JSON.stringify({ createdAt: new Date().toISOString(), model: MODEL_VERSION,
    source: 'dev catalog (helium), ELIGIBLE incl. placeholder exclusion', count: entries.length,
    cardRows: entries.reduce((s, e) => s + e.cardIds.length, 0), hash: sha(JSON.stringify(entries)), entries }));
  console.log(JSON.stringify({ images: entries.length, cardRows: entries.reduce((s, e) => s + e.cardIds.length, 0) }));
}

if (mode === 'worker') {
  const shard = Number(args[0]), shards = Number(args[1]);
  const limit = Number(args.find(a => a.startsWith('--limit='))?.slice(8) ?? Infinity);
  // Download budget across all shards (this shard's share), counting bytes already downloaded.
  const budgetBytes = Number(args.find(a => a.startsWith('--budget-gb='))?.slice(12) ?? Infinity) * 1e9 / shards;
  assert(Number.isInteger(shard) && shards >= 1 && shard < shards);
  const { entries }: { entries: Entry[] } = await read(MANIFEST);
  await fs.mkdir(CACHE, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });
  // Production run: vectors already built by the dev-manifest run, keyed by URL (same image, same model).
  const prior = new Map<string, { digest: string; current: Buffer; cropfix: Buffer }>();
  if (PROD) {
    const wanted = new Set(entries.filter((_, k) => k % shards === shard).map(e => e.url));
    const devEntries: Entry[] = (await read(path.join(DEV_RUN, 'manifest.json'))).entries;
    for (const f of await fs.readdir(DEV_RUN)) {
      const m = f.match(/^progress-(\d+)\.jsonl$/);
      if (!m) continue;
      const cur = await fs.readFile(path.join(DEV_RUN, `current-${m[1]}.f32`)), fix = await fs.readFile(path.join(DEV_RUN, `cropfix-${m[1]}.f32`));
      let row = 0;
      for (const line of (await fs.readFile(path.join(DEV_RUN, f), 'utf8')).split('\n').filter(Boolean)) {
        const l = JSON.parse(line);
        if (!l.ok) continue;
        const u = devEntries[l.k].url;
        if (wanted.has(u)) prior.set(u, { digest: l.digest, current: cur.subarray(row * BYTES, (row + 1) * BYTES), cropfix: fix.subarray(row * BYTES, (row + 1) * BYTES) });
        row++;
      }
    }
    console.log(JSON.stringify({ shard, reusableFromDevRun: prior.size }));
  }
  // Reuse originals already on disk from Phase B (keyed by URL).
  const local = new Map<string, string>();
  const manifestRows = (await read(devDataPath('broad-validation/reference-manifest.json'))).rows;
  for (const r of manifestRows) if (r.url && r.file) local.set(r.url, devDataPath(path.relative('.local', r.file)));
  const snapshot = await read(devDataPath('broad-validation/dev-catalog-snapshot.json'));
  for (const f of await fs.readdir(devDataPath('phase-b/references'))) {
    const row = snapshot.find((r: any) => r.id === Number(f.split('.')[0]));
    if (row?.url) local.set(row.url, devDataPath('phase-b/references', f));
  }
  const files = { current: path.join(OUT, `current-${shard}.f32`), cropfix: path.join(OUT, `cropfix-${shard}.f32`), progress: path.join(OUT, `progress-${shard}.jsonl`) };
  // Resume: progress lines are the source of truth; truncate vectors to match.
  const doneLines = existsSync(files.progress) ? (await fs.readFile(files.progress, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const written = doneLines.filter(l => l.ok).length;
  for (const f of [files.current, files.cropfix]) if (existsSync(f)) await fs.truncate(f, written * BYTES);
  const done = new Set(doneLines.map(l => l.k));
  let downloadedBytes = doneLines.filter(l => l.ok && l.source === 'download').reduce((sum, l) => sum + l.bytes, 0);
  const todo = entries.map((e, k) => ({ ...e, k })).filter(e => e.k % shards === shard && e.k < limit && !done.has(e.k));
  console.log(JSON.stringify({ shard, shards, alreadyDone: done.size, todo: todo.length }));

  // Download pipeline: per-worker share of the global concurrency and request-rate caps.
  const concurrency = Math.max(1, Math.floor(MAX_CONCURRENT_TOTAL / shards));
  const minGapMs = 1000 / (MAX_RPS_TOTAL / shards);
  let lastRequest = 0;
  const pace = async () => {
    const wait = lastRequest + minGapMs - Date.now();
    lastRequest = Math.max(Date.now(), lastRequest + minGapMs);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  };
  async function fetchBytes(url: string): Promise<{ bytes?: Buffer; error?: string; source: string }> {
    const cached = path.join(CACHE, `${sha(url)}.img`);
    for (const file of [local.get(url), cached]) if (file && existsSync(file)) return { bytes: await fs.readFile(file), source: 'disk' };
    let error = '';
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      await pace();
      try {
        const bytes = await downloadCatalogReference(url);
        await fs.writeFile(`${cached}.tmp`, bytes);
        await fs.rename(`${cached}.tmp`, cached); // atomic: a crash never leaves a partial cache file
        return { bytes, source: 'download' };
      } catch (e) {
        error = (e as Error).message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
        if (/HTTP 404\b/.test(error)) break; // gone: retrying cannot help
      }
    }
    return { error, source: 'download' };
  }
  const queue = [...todo];
  const ready: Promise<any>[] = [];
  const startFetch = () => {
    const item = queue.shift();
    if (!item) return;
    const reused = prior.get(item.url);
    ready.push(reused ? Promise.resolve({ item, reused, source: 'reused' }) : fetchBytes(item.url).then(r => ({ item, ...r })));
  };
  for (let i = 0; i < concurrency * 2; i++) startFetch();

  const byDigest = new Map<string, { current: Buffer; cropfix: Buffer }>();
  const started = Date.now();
  let n = 0;
  while (ready.length) {
    const { item, bytes, error, source, reused } = await ready.shift()! as any;
    startFetch();
    let line: any = { k: item.k, source };
    if (reused) {
      await fs.appendFile(files.current, reused.current);
      await fs.appendFile(files.cropfix, reused.cropfix);
      line = { ...line, ok: true, digest: reused.digest, bytes: 0 };
    } else if (!bytes) line = { ...line, ok: false, error };
    else {
      try {
        const digest = sha(bytes);
        let vectors = byDigest.get(digest);
        if (!vectors) {
          const current = Buffer.from(Float32Array.from(await embedCatalogVisualImage(bytes, 'background')).buffer);
          const cropfix = Buffer.from(Float32Array.from(await embedFixed(bytes)).buffer);
          vectors = { current, cropfix };
          byDigest.set(digest, vectors);
        }
        await fs.appendFile(files.current, vectors.current);
        await fs.appendFile(files.cropfix, vectors.cropfix);
        line = { ...line, ok: true, digest, bytes: bytes.length };
        if (source === 'download') downloadedBytes += bytes.length;
      } catch (e) { line = { ...line, ok: false, error: (e as Error).message.slice(0, 160) }; }
    }
    await fs.appendFile(files.progress, JSON.stringify(line) + '\n');
    if (downloadedBytes >= budgetBytes) {
      console.log(JSON.stringify({ shard, stopped: 'download budget reached', downloadedGB: downloadedBytes / 1e9, done: n + 1 }));
      process.exit(0);
    }
    if (++n % 250 === 0) console.log(JSON.stringify({ shard, done: n, of: todo.length, perImageMs: Math.round((Date.now() - started) / n) }));
  }
  console.log(JSON.stringify({ shard, finished: n, wallSeconds: (Date.now() - started) / 1000 }));
}

if (mode === 'status') {
  const { count } = await read(MANIFEST);
  const lines: any[] = [];
  const firstAt: number[] = [];
  for (const f of await fs.readdir(OUT)) if (/^progress-\d+\.jsonl$/.test(f)) {
    const stat = await fs.stat(path.join(OUT, f));
    firstAt.push(stat.birthtimeMs || stat.ctimeMs);
    lines.push(...(await fs.readFile(path.join(OUT, f), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)));
  }
  const ok = lines.filter(l => l.ok), failed = lines.filter(l => !l.ok);
  const downloaded = ok.filter(l => l.source === 'download');
  console.log(JSON.stringify({ total: count, done: lines.length, ok: ok.length, failed: failed.length,
    failureRate: lines.length ? failed.length / lines.length : 0,
    downloadedImages: downloaded.length, downloadedMB: Math.round(downloaded.reduce((s, l) => s + l.bytes, 0) / 1e6),
    meanDownloadKB: downloaded.length ? Math.round(downloaded.reduce((s, l) => s + l.bytes, 0) / downloaded.length / 1e3) : null,
    failureSamples: [...new Set(failed.map(l => l.error))].slice(0, 5) }));
}

if (mode === 'assemble') {
  const { entries, count, hash } = await read(MANIFEST);
  const shards = (await fs.readdir(OUT)).filter(f => /^progress-\d+\.jsonl$/.test(f)).map(f => Number(f.match(/\d+/)![0]));
  const order: { k: number; shard: number; row: number }[] = [];
  for (const s of shards) {
    const lines = (await fs.readFile(path.join(OUT, `progress-${s}.jsonl`), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    let row = 0;
    for (const l of lines) if (l.ok) order.push({ k: l.k, shard: s, row: row++ });
  }
  order.sort((a, b) => a.k - b.k);
  for (const variant of ['current', 'cropfix']) {
    const shardData = new Map<number, Buffer>();
    for (const s of shards) shardData.set(s, await fs.readFile(path.join(OUT, `${variant}-${s}.f32`)));
    const out = Buffer.alloc(order.length * BYTES);
    order.forEach((o, i) => shardData.get(o.shard)!.copy(out, i * BYTES, o.row * BYTES, (o.row + 1) * BYTES));
    await fs.writeFile(path.join(OUT, `${variant}.f32`), out);
  }
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify({ model: MODEL_VERSION, manifestHash: hash, manifestCount: count,
    indexed: order.length, missing: count - order.length, rows: order.map(o => ({ k: o.k, cardIds: entries[o.k].cardIds })) }));
  console.log(JSON.stringify({ indexed: order.length, missing: count - order.length }));
}

if (mode === 'verify') {
  // Run after `assemble`, before deleting the image cache.
  const index = await read(path.join(OUT, 'index.json'));
  const f32 = async (v: string) => { const b = await fs.readFile(path.join(OUT, `${v}.f32`)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const cur = await f32('current'), fix = await f32('cropfix');
  assert.equal(cur.length, index.rows.length * DIM); assert.equal(fix.length, index.rows.length * DIM);
  let badNorm = 0;
  for (const m of [cur, fix]) for (let r = 0; r < index.rows.length; r++) {
    let n = 0; for (let d = 0; d < DIM; d++) { const x = m[r * DIM + d]; if (!Number.isFinite(x)) { n = NaN; break; } n += x * x; }
    if (!(Math.abs(Math.sqrt(n) - 1) < 1e-4)) badNorm++;
  }
  // Digest per row, from the progress logs (order = assembled order by k).
  const digestByK = new Map<number, { digest: string; source: string }>();
  for (const f of await fs.readdir(OUT)) if (/^progress-\d+\.jsonl$/.test(f))
    for (const l of (await fs.readFile(path.join(OUT, f), 'utf8')).split('\n').filter(Boolean).map(x => JSON.parse(x))) if (l.ok) digestByK.set(l.k, l);
  // Phase B parity on shared images.
  const pb = await read(devDataPath('phase-b/index.json'));
  let pbChecked = 0, pbMax = 0;
  index.rows.forEach((r: any, i: number) => {
    const d = digestByK.get(r.k)?.digest; const b = d && pb.baseline[d], f = d && pb.fixed[d];
    if (!b || !f) return;
    pbChecked++;
    for (let j = 0; j < DIM; j++) pbMax = Math.max(pbMax, Math.abs(cur[i * DIM + j] - b[j]), Math.abs(fix[i * DIM + j] - f[j]));
  });
  // Re-embed a seeded random sample of downloaded images from the cache.
  const { entries } = await read(MANIFEST);
  const downloaded = index.rows.map((r: any, i: number) => ({ r, i })).filter(({ r }: any) => digestByK.get(r.k)?.source === 'download');
  let seed = 20261001; const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let reChecked = 0, reMax = 0;
  for (let n = 0; n < 20 && downloaded.length; n++) {
    const { r, i } = downloaded[Math.floor(rand() * downloaded.length)];
    const file = path.join(CACHE, `${sha(entries[r.k].url)}.img`);
    if (!existsSync(file)) continue;
    const bytes = await fs.readFile(file);
    const a = await embedCatalogVisualImage(bytes, 'background'), b = await embedFixed(bytes);
    reChecked++;
    for (let j = 0; j < DIM; j++) reMax = Math.max(reMax, Math.abs(cur[i * DIM + j] - a[j]), Math.abs(fix[i * DIM + j] - b[j]));
  }
  const result = { rows: index.rows.length, manifestCount: index.manifestCount, missing: index.missing, badNorm,
    phaseBParity: { checked: pbChecked, maxAbsDiff: pbMax }, reembed: { checked: reChecked, maxAbsDiff: reMax },
    currentSha256: sha(await fs.readFile(path.join(OUT, 'current.f32'))), cropfixSha256: sha(await fs.readFile(path.join(OUT, 'cropfix.f32'))),
    indexJsonSha256: sha(await fs.readFile(path.join(OUT, 'index.json'))) };
  await fs.writeFile(path.join(OUT, 'verify.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.equal(badNorm, 0); assert(pbChecked > 0 && pbMax < 1e-6, 'Phase B parity'); assert(reChecked >= 15 && reMax < 1e-6, 're-embed parity');
}

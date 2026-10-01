// DEV-ONLY Phase B experiment harness (pre-registered arms; see docs/scan-plan-phase-b.md).
// Modes:
//   probe   verify crop-fix processor settings keep the full 224x224 input
//   index   rebuild the frozen 3,045-card index (strong41 recipe) and embed it twice
//   export  read-only production SELECT of the 41 frozen scan photo URLs (requires --authorized)
//   run     run every arm over the 41 cases
// Files live under .local/phase-b (gitignored). No database writes anywhere.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import pg from 'pg';
import {
  embedCatalogVisualImage, visualCosine, normalizeVisualVector, bundledVisualModelPath, MODEL_REVISION, MODEL_VERSION,
} from '../server/services/catalogVisualModel';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
import { orderCardCorners } from '../shared/cardCorners';
import { devDataPath } from '../server/devData';

process.umask(0o077);
process.env.CATALOG_VISUAL_OFFLINE = 'true';
const ROOT = devDataPath('phase-b');
const mode = process.argv[2];
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const save = (name: string, v: unknown) => fs.writeFile(path.join(ROOT, name), JSON.stringify(v, null, 2), { mode: 0o600 });
const old = await read('attached_assets/dev-broad-readonly-production-results.json');
const FROZEN_41: number[] = old.perCase.map((c: any) => c.scanId);
assert.equal(FROZEN_41.length, 41);
const STRONG41_INDEX_HASH = '45323e43c1f556c09b4813eff21f4398b6806fff052eeecb734705957fa23069';
const GRAY = { r: 0x77, g: 0x77, b: 0x77 };

// ---------- embedding ----------
// Arm 0 uses the production function unchanged. The crop fix uses the same model
// with the processor's resize-to-256 and center-crop-224 disabled, so the
// 224x224 letterboxed card reaches the model whole.
let fixPipe: any;
async function embedFixed(buffer: Buffer): Promise<number[]> {
  if (!fixPipe) {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false;
    fixPipe = await pipeline('image-feature-extraction', bundledVisualModelPath(), {
      revision: MODEL_REVISION, device: 'cpu', dtype: 'q8', local_files_only: true,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
    const processor = fixPipe.processor.image_processor ?? fixPipe.processor;
    processor.do_resize = false;
    processor.do_center_crop = false;
  }
  const { RawImage } = await import('@huggingface/transformers');
  const { data, info } = await sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate().resize(224, 224, { fit: 'contain', background: '#777777' })
    .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const output = await fixPipe(new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3));
  assert.deepEqual(output.dims, [1, 257, 384]);
  return normalizeVisualVector(output.data.slice(0, 384));
}

// ---------- query transforms ----------
// Same steps as scanService.preprocessImage (the production OCR/DINO query buffer).
async function productionQueryBuffer(buffer: Buffer) {
  const image = sharp(buffer).rotate();
  const width = (await image.metadata()).width || 0;
  let p = image;
  if (width > 0 && width < 1000) p = p.resize({ width: 1200, withoutEnlargement: false });
  else if (width > 2400) p = p.resize({ width: 2400 });
  return p.normalize().sharpen().jpeg({ quality: 90 }).toBuffer();
}
async function centerCrop(buffer: Buffer, fraction: number) {
  const img = sharp(await sharp(buffer).rotate().toBuffer());
  const { width = 0, height = 0 } = await img.metadata();
  const w = Math.round(width * fraction), h = Math.round(height * fraction);
  return img.extract({ left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h }).toBuffer();
}
async function padToCardAspect(buffer: Buffer) {
  const { width = 0, height = 0 } = await sharp(buffer).metadata();
  const portrait = height >= width, ratio = portrait ? 5 / 7 : 7 / 5;
  const targetW = Math.max(width, Math.round(height * ratio)), targetH = Math.max(height, Math.round(width / ratio));
  const left = Math.floor((targetW - width) / 2), top = Math.floor((targetH - height) / 2);
  return sharp(buffer).extend({ left, right: targetW - width - left, top, bottom: targetH - height - top, background: GRAY })
    .jpeg({ quality: 95 }).toBuffer();
}
type Point = [number, number];
async function oriented(buffer: Buffer) {
  const { data, info } = await sharp(buffer).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
// Arm 4: axis-aligned box around the 4 corners, turned upright by the multiple of 90 degrees
// implied by the clicked top edge (TL->TR), then padded to 5:7 (7:5 for landscape cards).
async function cleanCrop(buffer: Buffer, corners: Point[]) {
  const img = await oriented(buffer);
  const px = corners.map(([x, y]) => [x * img.width, y * img.height]);
  const left = Math.max(0, Math.floor(Math.min(...px.map(p => p[0])))), top = Math.max(0, Math.floor(Math.min(...px.map(p => p[1]))));
  const right = Math.min(img.width, Math.ceil(Math.max(...px.map(p => p[0])))), bottom = Math.min(img.height, Math.ceil(Math.max(...px.map(p => p[1]))));
  const angle = Math.atan2(px[1][1] - px[0][1], px[1][0] - px[0][0]) * 180 / Math.PI;
  const turn = ((Math.round(-angle / 90) * 90) % 360 + 360) % 360;
  const box = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .extract({ left, top, width: right - left, height: bottom - top }).rotate(turn).png().toBuffer();
  return padToCardAspect(box);
}
// Arm 5: perspective-rectify the quadrilateral to 5:7 (7:5 if the printed top edge is the long edge).
function homography(src: number[][], dst: number[][]) {
  // Solve for H mapping dst -> src (8 unknowns), by Gaussian elimination.
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    [A[c], A[pivot]] = [A[pivot], A[c]]; [b[c], b[pivot]] = [b[pivot], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}
async function rectifiedCrop(buffer: Buffer, corners: Point[]) {
  const img = await oriented(buffer);
  const px = corners.map(([x, y]) => [x * img.width, y * img.height]);
  const d = (a: number[], c: number[]) => Math.hypot(a[0] - c[0], a[1] - c[1]);
  const landscape = (d(px[0], px[1]) + d(px[3], px[2])) > (d(px[0], px[3]) + d(px[1], px[2]));
  const W = landscape ? 700 : 500, H = landscape ? 500 : 700;
  const h = homography(px, [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]]);
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = h[6] * x + h[7] * y + h[8];
    const u = (h[0] * x + h[1] * y + h[2]) / z, v = (h[3] * x + h[4] * y + h[5]) / z;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    for (let ch = 0; ch < 3; ch++) {
      const at = (xx: number, yy: number) => {
        const cx = Math.min(img.width - 1, Math.max(0, xx)), cy = Math.min(img.height - 1, Math.max(0, yy));
        return img.data[(cy * img.width + cx) * 3 + ch];
      };
      out[(y * W + x) * 3 + ch] = Math.round(
        at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy);
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

// ---------- modes ----------
if (mode === 'probe') {
  // A red band in rows 0-9 must survive the crop-fix path (production trims it).
  const raw = Buffer.alloc(224 * 224 * 3, 0x77);
  for (let i = 0; i < 224 * 10; i++) { raw[i * 3] = 255; raw[i * 3 + 1] = 0; raw[i * 3 + 2] = 0; }
  const probe = await sharp(raw, { raw: { width: 224, height: 224, channels: 3 } }).png().toBuffer();
  await embedFixed(probe);
  const processor = fixPipe.processor.image_processor ?? fixPipe.processor;
  const { RawImage } = await import('@huggingface/transformers');
  const inputs = await fixPipe.processor(new RawImage(new Uint8ClampedArray(raw), 224, 224, 3));
  const pixels = inputs.pixel_values;
  const redRow0 = pixels.data[0], redRow9 = pixels.data[9 * 224];
  console.log(JSON.stringify({ do_resize: processor.do_resize, do_center_crop: processor.do_center_crop, dims: pixels.dims,
    normalizedRedAtRow0: redRow0, normalizedRedAtRow9: redRow9, expectedRed: (1 - 0.485) / 0.229 }));
  assert.deepEqual(pixels.dims, [1, 3, 224, 224]);
  assert(Math.abs(redRow0 - (1 - 0.485) / 0.229) < 0.01 && Math.abs(redRow9 - (1 - 0.485) / 0.229) < 0.01);
  console.log('probe ok: full 224x224 input reaches the model');
}

if (mode === 'index') {
  await fs.mkdir(path.join(ROOT, 'references'), { recursive: true });
  const dev = await read(devDataPath('broad-validation/dev-catalog-snapshot.json'));
  const manifest = await read(devDataPath('broad-validation/reference-manifest.json'));
  const selected = new Map<number, any>(manifest.rows.filter((r: any) => !r.error).map((r: any) => [r.id, { ...r, file: devDataPath(path.relative('.local', r.file)) }]));
  // Same recipe and order as scripts/dev-strong41-run.ts 'prepare' (3,045-card index).
  const usable = (r: any) => r.url?.startsWith('https://res.cloudinary.com/') && !r.url.includes('/scan_uploads/') && !r.archived_at && r.set_active && !r.set_archived;
  const byHash = (a: any, b: any) => hash(String(a.id)).localeCompare(hash(String(b.id)));
  for (const c of old.perCase) {
    const p = dev.find((r: any) => r.id === c.confirmedCardId);
    if (!p || !usable(p)) continue;
    const extra = [p,
      ...dev.filter((r: any) => usable(r) && r.id !== p.id && r.main_set_id === p.main_set_id && r.card_number === p.card_number).sort(byHash).slice(0, 4),
      ...dev.filter((r: any) => usable(r) && r.id !== p.id && r.name.toLowerCase() === p.name.toLowerCase()).sort(byHash).slice(0, 2)];
    for (const r of extra) if (!selected.has(r.id)) {
      const file = path.join(ROOT, 'references', `${r.id}.image`);
      let bytes: Buffer;
      try { bytes = await fs.readFile(file); } catch { bytes = await downloadCatalogReference(r.url); await fs.writeFile(file, bytes, { mode: 0o600 }); }
      selected.set(r.id, { ...r, file, digest: hash(bytes) });
    }
  }
  const refs = [...selected.values()];
  const indexHash = hash(JSON.stringify(refs.map(r => ({ id: r.id, digest: r.digest }))));
  console.log(JSON.stringify({ indexIds: refs.length, indexHash, matchesStrong41: indexHash === STRONG41_INDEX_HASH }));
  const digests = new Map<string, string>();
  for (const r of refs) if (!digests.has(r.digest)) digests.set(r.digest, r.file);
  const baseline: Record<string, number[]> = {}, fixed: Record<string, number[]> = {};
  let cached = 0, t0 = performance.now(), n = 0;
  for (const [digest, file] of digests) {
    const bytes = await fs.readFile(file);
    assert.equal(hash(bytes), digest);
    try {
      const v = await read(devDataPath(`broad-validation/vectors/${digest}.json`));
      assert.equal(v.model, MODEL_VERSION);
      baseline[digest] = v.vector; cached++;
    } catch { baseline[digest] = await embedCatalogVisualImage(bytes, 'background'); }
    fixed[digest] = await embedFixed(bytes);
    if (++n % 250 === 0) console.log(`embedded ${n}/${digests.size} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  await save('index.json', { model: MODEL_VERSION, indexHash, matchesStrong41: indexHash === STRONG41_INDEX_HASH,
    refs: refs.map(r => ({ id: r.id, digest: r.digest, name: r.name, card_number: r.card_number, main_set_id: r.main_set_id, variation: r.variation })),
    baseline, fixed, cachedBaselineVectors: cached, wallSeconds: (performance.now() - t0) / 1000 });
  console.log(JSON.stringify({ uniqueImages: digests.size, cachedBaselineVectors: cached, wallSeconds: (performance.now() - t0) / 1000 }));
}

if (mode === 'export') {
  // Read-only, one SELECT, 41 frozen IDs, URLs never printed. Requires explicit authorization.
  assert(process.argv.includes('--authorized'), 'Export requires --authorized (approved by the owner)');
  const url = new URL(process.env.NEON_DATABASE_URL!);
  console.log(`production read-only export from host=${url.hostname} db=${url.pathname.slice(1)}`);
  const client = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, options: '-c default_transaction_read_only=on' });
  await client.connect();
  let rows: { id: number; image_url: string | null }[];
  try {
    await client.query('BEGIN READ ONLY');
    rows = (await client.query('SELECT id, image_url FROM scan_uploads WHERE id = ANY($1::int[]) ORDER BY id', [FROZEN_41])).rows;
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  assert.equal(rows.length, 41, 'all 41 frozen scans must exist');
  await fs.mkdir(path.join(ROOT, 'queries'), { recursive: true });
  const cases = [];
  for (const row of rows) {
    assert(row.image_url?.startsWith('https://res.cloudinary.com/'), `scan ${row.id}: unexpected image host`);
    const response = await fetch(row.image_url, { signal: AbortSignal.timeout(60_000) });
    assert(response.ok, `scan ${row.id}: download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = path.join('queries', `${row.id}.image`);
    await fs.writeFile(path.join(ROOT, file), bytes, { mode: 0o600 });
    cases.push({ scanId: row.id, cardId: old.perCase.find((c: any) => c.scanId === row.id).confirmedCardId, file, digest: hash(bytes) });
  }
  await save('cases.json', cases);
  console.log(JSON.stringify({ exported: cases.length, location: path.join(ROOT, 'queries') }));
}

if (mode === 'run') {
  const index = await read(path.join(ROOT, 'index.json'));
  const cases: any[] = await read(path.join(ROOT, 'cases.json'));
  // Phase B corners were clicked in reading order; orderCardCorners reproduces the
  // reordered set used in the run exactly (shared/cardCorners.test.ts).
  const clicked: Record<string, { corners: Point[] }> = await read(path.join(ROOT, 'corners.json'));
  const corners = Object.fromEntries(Object.entries(clicked).map(([id, v]) => [id, { corners: orderCardCorners(v.corners) }]));
  const dev = await read(devDataPath('broad-validation/dev-catalog-snapshot.json'));
  // Physical-card groups (pre-registered): the two known duplicate pairs, plus any active
  // catalog record with the same main set, card number, name and variation as the confirmed card.
  const known = [[20279, 530526], [20280, 530527]];
  const norm = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const physical = (cardId: number) => {
    const p = dev.find((r: any) => r.id === cardId);
    const ids = new Set<number>([cardId, ...known.filter(k => k.includes(cardId)).flat()]);
    if (p) for (const r of dev) if (!r.archived_at && r.main_set_id === p.main_set_id && norm(r.card_number) === norm(p.card_number)
      && norm(r.name) === norm(p.name) && norm(r.variation) === norm(p.variation)) ids.add(r.id);
    return [...ids];
  };
  const refVectors = (which: 'baseline' | 'fixed') => index.refs.map((r: any) => ({ id: r.id, v: Float32Array.from(index[which][r.digest]) }));
  const pools = { baseline: refVectors('baseline'), fixed: refVectors('fixed') };
  const rank = (queryVectors: number[][], pool: { id: number; v: Float32Array }[], ids: number[]) => {
    const scored = pool.map(r => ({ id: r.id, s: Math.max(...queryVectors.map(q => visualCosine(q, r.v))) }))
      .sort((a, b) => b.s - a.s || a.id - b.id);
    const exact = scored.findIndex(r => r.id === ids[0]) + 1;
    const phys = scored.findIndex(r => ids.includes(r.id)) + 1;
    return { exact: exact || null, physical: phys || null, top1: scored[0].id, top1Score: scored[0].s, margin: scored[0].s - scored[1].s };
  };
  type Arm = { name: string; pool: 'baseline' | 'fixed'; needsCorners?: boolean; query: (b: Buffer, c?: Point[]) => Promise<number[][]> };
  const fix = (f: (b: Buffer, c?: Point[]) => Promise<Buffer>) => async (b: Buffer, c?: Point[]) => [await embedFixed(await f(b, c))];
  const tta = (f: (b: Buffer, c?: Point[]) => Promise<Buffer>) => async (b: Buffer, c?: Point[]) => {
    const base = await f(b, c);
    return Promise.all([base, await centerCrop(base, 0.85), await centerCrop(base, 0.7)].map(x => embedFixed(x)));
  };
  const original = async (b: Buffer) => b;
  const arms: Arm[] = [
    { name: '0 baseline (historical: original photo, production embed)', pool: 'baseline', query: async b => [await embedCatalogVisualImage(b)] },
    { name: '0P production query (sharpened), production embed', pool: 'baseline', query: async b => [await embedCatalogVisualImage(await productionQueryBuffer(b))] },
    { name: '1 crop fix, production (sharpened) query', pool: 'fixed', query: fix(productionQueryBuffer) },
    { name: '2 crop fix, unsharpened query', pool: 'fixed', query: fix(original) },
    { name: '3 arm 2 + 3-crop TTA', pool: 'fixed', query: tta(original) },
    { name: '4 crop fix, clean crop (box, 5:7 pad)', pool: 'fixed', needsCorners: true, query: fix((b, c) => cleanCrop(b, c!)) },
    { name: '5 crop fix, rectified crop (warp to 5:7)', pool: 'fixed', needsCorners: true, query: fix((b, c) => rectifiedCrop(b, c!)) },
  ];
  const results: any[] = [];
  for (const arm of arms) {
    const rows = [];
    for (const c of cases) {
      const cc = corners[c.scanId]?.corners;
      if (arm.needsCorners && !cc) { rows.push({ scanId: c.scanId, skipped: 'no-corners' }); continue; }
      const bytes = await fs.readFile(path.join(ROOT, c.file));
      const t = performance.now();
      const vectors = await arm.query(bytes, cc);
      const r = rank(vectors, pools[arm.pool], physical(c.cardId));
      rows.push({ scanId: c.scanId, cardId: c.cardId, ms: performance.now() - t, ...r });
    }
    results.push({ arm: arm.name, rows });
    console.log(`done arm ${arm.name}`);
  }
  // Arm 6: the better of arms 4/5 (Top-1, then Top-10, then arm 5) + the arm-3 TTA.
  const hits = (rows: any[], k: number) => rows.filter(r => r.exact && r.exact <= k).length;
  const [a4, a5] = [results[5].rows, results[6].rows];
  const use4 = hits(a4, 1) > hits(a5, 1) || (hits(a4, 1) === hits(a5, 1) && hits(a4, 10) > hits(a5, 10));
  const crop = use4 ? cleanCrop : rectifiedCrop;
  const rows6 = [];
  for (const c of cases) {
    const cc = corners[c.scanId]?.corners;
    if (!cc) { rows6.push({ scanId: c.scanId, skipped: 'no-corners' }); continue; }
    const bytes = await fs.readFile(path.join(ROOT, c.file));
    const t = performance.now();
    const vectors = await tta(b => crop(b, cc))(bytes);
    rows6.push({ scanId: c.scanId, cardId: c.cardId, ms: performance.now() - t, ...rank(vectors, pools.fixed, physical(c.cardId)) });
  }
  results.push({ arm: `6 arm ${use4 ? 4 : 5} + 3-crop TTA`, rows: rows6 });
  await save('runs.json', { model: MODEL_VERSION, indexHash: index.indexHash, results,
    physicalGroups: Object.fromEntries(cases.map(c => [c.scanId, physical(c.cardId)]).filter(([, ids]) => (ids as number[]).length > 1)) });
}

if (mode === 'report') {
  const runs = await read(path.join(ROOT, 'runs.json'));
  const at = (rows: any[], key: 'exact' | 'physical', k: number) => rows.filter(r => r[key] && r[key] <= k).length;
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
  const base = runs.results[0].rows;
  const top1 = (r: any) => r?.exact === 1;
  const summary = runs.results.map((a: any) => {
    const rows = a.rows.filter((r: any) => !r.skipped);
    const ms = rows.slice(1).map((r: any) => r.ms); // first query includes model warm-up
    const versus = (ref: any[]) => ({
      top1Gains: rows.filter((r: any) => top1(r) && !top1(ref.find((b: any) => b.scanId === r.scanId))).length,
      top1Losses: rows.filter((r: any) => !top1(r) && top1(ref.find((b: any) => b.scanId === r.scanId))).length,
    });
    const rankChange = rows.map((r: any) => {
      const b = base.find((x: any) => x.scanId === r.scanId);
      const before = b.exact ?? Infinity, after = r.exact ?? Infinity;
      return after < before ? 'improved' : after > before ? 'worsened' : 'unchanged';
    });
    return {
      arm: a.arm, n: rows.length,
      exact: [1, 3, 5, 10].map(k => at(rows, 'exact', k)), physical: [1, 3, 5, 10].map(k => at(rows, 'physical', k)),
      msMedian: median(ms), msP95: p95(ms), vsArm0: versus(base),
      improved: rankChange.filter((x: string) => x === 'improved').length,
      unchanged: rankChange.filter((x: string) => x === 'unchanged').length,
      worsened: rankChange.filter((x: string) => x === 'worsened').length,
      versus,
    };
  });
  const [s0, , s1, s2, s3, s4, s5] = summary;
  const gate = [0, 1, 3].every((i, j) => Math.abs(s0.exact[i] - [29, 32, 35][j]) <= 1);
  const best13 = [s1, s2, s3].sort((a, b) => b.exact[0] - a.exact[0] || b.exact[3] - a.exact[3])[0];
  const bestRows = runs.results[summary.indexOf(best13)].rows;
  const preprocessingPass = best13.exact[0] >= 32 && best13.exact[3] >= 36 && best13.vsArm0.top1Losses <= 1 && best13.msP95 <= 400;
  const cropVerdict = [s4, s5].map(s => ({ arm: s.arm, top1: s.exact[0], deltaVsBest13: s.exact[0] - best13.exact[0],
    top1LossesVsBest13: s.versus(bestRows).top1Losses }));
  const worthBuilding = cropVerdict.some(c => c.deltaVsBest13 >= 3 && c.top1LossesVsBest13 <= 1);
  const perCase = base.map((b: any) => ({ scanId: b.scanId, cardId: b.cardId,
    ranks: Object.fromEntries(runs.results.map((a: any) => {
      const r = a.rows.find((x: any) => x.scanId === b.scanId);
      return [a.arm.split(' ')[0], r.skipped ? null : { exact: r.exact, physical: r.physical }];
    })) }));
  const out = { gate: { pass: gate, arm0: s0.exact, target: [29, 32, 35] },
    summary: summary.map(({ versus, ...s }: any) => s), bestOfArms1to3: best13.arm,
    preprocessingPass, cleanCrop: { worthBuilding, arms: cropVerdict }, physicalGroups: runs.physicalGroups, perCase };
  await save('report.json', out);
  console.log(JSON.stringify(out, null, 1));
}

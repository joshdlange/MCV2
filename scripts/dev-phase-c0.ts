// DEV-ONLY Phase C0 run harness (docs/scan-plan-phase-c0.md, incl. Addendum A).
// Modes:
//   freeze             hash labels.json + every photo into freeze.json (batch 1; once, before any run)
//   freeze --batch=2   freeze the items added after batch 1 into freeze-batch2.json (held-out batch 2)
//   run      arms A/B/C x {I-3045, I-full} on single photos; binder pages; writes results/runs.json
// Reads MCV_DEV_DATA (default .local). No database access, no network.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { embedCatalogVisualImage, normalizeVisualVector, bundledVisualModelPath, MODEL_REVISION, MODEL_VERSION } from '../server/services/catalogVisualModel';
import { devDataPath } from '../server/devData';

process.umask(0o077);
process.env.CATALOG_VISUAL_OFFLINE = 'true';
const C0 = devDataPath('phase-c0');
const DIM = 384;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const mode = process.argv[2];
const GRAY = { r: 0x77, g: 0x77, b: 0x77 };

// ---------- embedding (identical to scripts/dev-phase-b.ts) ----------
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
function homography(src: number[][], dst: number[][]) {
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

// Arms (§3). Each returns the query vectors; references use the matching variant.
type Variant = 'current' | 'cropfix';
const ARMS: { name: string; variant: Variant; query: (b: Buffer) => Promise<number[][]> }[] = [
  { name: 'A', variant: 'current', query: async b => [await embedCatalogVisualImage(b)] },
  // Phase B arm 3 exactly: original + 0.85 and 0.70 center crops, crop-fix embedding, best of 3.
  { name: 'B', variant: 'cropfix', query: async b => Promise.all([b, await centerCrop(b, 0.85), await centerCrop(b, 0.7)].map(x => embedFixed(x))) },
  { name: 'C', variant: 'current', query: async b => Promise.all([b, await centerCrop(b, 0.85), await centerCrop(b, 0.7)].map(x => embedCatalogVisualImage(x))) },
];
// Same arm without TTA (binder report-only): B -> crop-fix single, C -> A.
const NO_TTA: Record<string, { variant: Variant; query: (b: Buffer) => Promise<number[][]> }> = {
  B: { variant: 'cropfix', query: async b => [await embedFixed(b)] },
  C: { variant: 'current', query: async b => [await embedCatalogVisualImage(b)] },
};

// ---------- identity and duplicate rule (§4, applied on the production snapshot) ----------
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const identity = (name: unknown, num: unknown, variation: unknown, setName: unknown) => [norm(name), norm(num), norm(variation), norm(setName)].join('|');
const isBaseSet = (setName: unknown, mainSetName: unknown) =>
  norm(setName).replace(norm(mainSetName), '').replace(/(19|20)\d\d/g, '').replace('base', '') === '';

// Batch 1 is the original freeze. Later batches freeze only the items added after it; the intake
// server appends items and writes JSON.stringify(list, null, 2), so each batch's label hash is
// verifiable by re-serializing just that batch's items in order.
const BATCH = Number(process.argv.find(a => a.startsWith('--batch='))?.slice(8) ?? 1);
const freezeFile = (batch: number) => path.join(C0, batch === 1 ? 'freeze.json' : `freeze-batch${batch}.json`);

if (mode === 'freeze') {
  const target = freezeFile(BATCH);
  assert(!existsSync(target), `batch ${BATCH} freeze already exists`);
  const all = JSON.parse((await fs.readFile(path.join(C0, 'labels.json'))).toString());
  let items = all;
  if (BATCH > 1) {
    const earlier = new Set<string>();
    for (let b = 1; b < BATCH; b++) for (const p of (await read(freezeFile(b))).photos) earlier.add(p.id);
    items = all.filter((i: any) => !earlier.has(i.id));
    assert(items.length > 0, 'no new items to freeze');
  }
  const labelsSha256 = BATCH === 1 ? sha(await fs.readFile(path.join(C0, 'labels.json'))) : sha(JSON.stringify(items, null, 2));
  const photos = [];
  for (const item of items) photos.push({ id: item.id, file: item.file, sha256: sha(await fs.readFile(path.join(C0, item.file))) });
  const freeze = { batch: BATCH, createdAt: new Date().toISOString(), labelsSha256, singles: items.filter((i: any) => i.kind === 'single').length,
    binderPages: items.filter((i: any) => i.kind === 'binder').length, photos };
  await fs.writeFile(target, JSON.stringify(freeze, null, 2));
  console.log(JSON.stringify({ ...freeze, photos: photos.length, freezeSha256: sha(JSON.stringify(freeze)) }));
}

if (mode === 'run') {
  // Freeze check: results are valid only against the frozen labels and photos of each batch.
  const all: any[] = JSON.parse((await fs.readFile(path.join(C0, 'labels.json'))).toString());
  const items: any[] = [];
  const freezes: any[] = [];
  for (let b = 1; existsSync(freezeFile(b)); b++) {
    const f = await read(freezeFile(b));
    const ids = f.photos.map((p: any) => p.id);
    const batchItems = ids.map((id: string) => all.find(i => i.id === id));
    assert(batchItems.every(Boolean), `batch ${b}: a frozen item is missing from labels.json`);
    assert.equal(sha(JSON.stringify(batchItems, null, 2)), f.labelsSha256, `batch ${b}: labels changed after the freeze`);
    for (const p of f.photos) assert.equal(sha(await fs.readFile(path.join(C0, p.file))), p.sha256, `batch ${b}: photo ${p.id} changed after the freeze`);
    items.push(...batchItems.map((i: any) => ({ ...i, batch: b })));
    freezes.push({ batch: b, labelsSha256: f.labelsSha256, photos: f.photos.length });
  }
  const unfrozen = all.filter(i => !items.some(x => x.id === i.id));
  assert.equal(unfrozen.length, 0, `${unfrozen.length} uploaded item(s) are not in any freeze`);
  const freeze = { labelsSha256: freezes.map(f => f.labelsSha256).join(',') };

  // Production catalog of record (Addendum A).
  const prodCards: any[] = (await read(path.join(C0, 'prod-catalog/cards.json'))).cards;
  const prodById = new Map<number, any>(prodCards.map(c => [c.id, c]));
  const dupKey = (c: any) => [c.mainSetId, norm(c.cardNumber), norm(c.name), norm(c.variation)].join('|');
  const baseByKey = new Map<string, number[]>();
  for (const c of prodCards) if (!c.archived && c.setActive && isBaseSet(c.setName, c.mainSetName)) {
    const k = dupKey(c); baseByKey.set(k, [...(baseByKey.get(k) ?? []), c.id]);
  }
  const duplicatesOf = (id: number): number[] => {
    const c = prodById.get(id);
    if (!c || !isBaseSet(c.setName, c.mainSetName)) return [];
    return (baseByKey.get(dupKey(c)) ?? []).filter(x => x !== id);
  };

  // I-full: assembled production-manifest index.
  const fullDir = devDataPath('phase-c0/index-prod');
  const fullIndex = await read(path.join(fullDir, 'index.json'));
  const loadF32 = async (f: string) => { const b = await fs.readFile(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const full = { rows: fullIndex.rows as { k: number; cardIds: number[] }[],
    current: await loadF32(path.join(fullDir, 'current.f32')), cropfix: await loadF32(path.join(fullDir, 'cropfix.f32')) };
  assert.equal(full.current.length, full.rows.length * DIM);
  const fullCardRow = new Map<number, number>();
  full.rows.forEach((r, i) => r.cardIds.forEach(id => fullCardRow.set(id, i)));

  // I-3045: Phase B index unchanged; dev card IDs, scored by identity (Addendum A §4).
  const pb = await read(devDataPath('phase-b/index.json'));
  const devSnapshot: any[] = await read(devDataPath('broad-validation/dev-catalog-snapshot.json'));
  const devById = new Map<number, any>(devSnapshot.map(r => [r.id, r]));
  const small = { rows: pb.refs.map((r: any) => ({ id: r.id, key: identity(devById.get(r.id)?.name, devById.get(r.id)?.card_number, devById.get(r.id)?.variation, devById.get(r.id)?.set_name) })),
    current: Float32Array.from(pb.refs.flatMap((r: any) => pb.baseline[r.digest])), cropfix: Float32Array.from(pb.refs.flatMap((r: any) => pb.fixed[r.digest])) };

  const scoreRows = (vectors: number[][], matrix: Float32Array, n: number) => {
    const scores = new Float32Array(n).fill(-Infinity);
    for (const q of vectors) for (let r = 0; r < n; r++) {
      let dot = 0; const o = r * DIM;
      for (let d = 0; d < DIM; d++) dot += q[d] * matrix[o + d];
      if (dot > scores[r]) scores[r] = dot;
    }
    return scores;
  };
  // Card-level rank with ties broken by lower card ID; null = target not in the index.
  const rankIn = (cards: { id: number; s: number }[], isTarget: (id: number) => boolean) => {
    let best: { id: number; s: number } | undefined;
    for (const c of cards) if (isTarget(c.id) && (!best || c.s > best.s || (c.s === best.s && c.id < best.id))) best = c;
    if (!best) return null;
    let rank = 1;
    for (const c of cards) if (c.s > best.s || (c.s === best.s && c.id < best.id)) rank++;
    return rank;
  };
  const top = (cards: { id: number; s: number }[]) => {
    const sorted = [...cards].sort((a, b) => b.s - a.s || a.id - b.id);
    return { top1Id: sorted[0].id, top1Score: sorted[0].s, margin: sorted[0].s - sorted[1].s };
  };
  function search(index: 'full' | 'small', variant: Variant, vectors: number[][], labelId: number) {
    const t = performance.now();
    const target = [labelId, ...duplicatesOf(labelId)];
    let cards: { id: number; s: number }[], exact: number | null, dup: number | null, findable: boolean;
    if (index === 'full') {
      const scores = scoreRows(vectors, full[variant], full.rows.length);
      cards = [];
      full.rows.forEach((r, i) => r.cardIds.forEach(id => cards.push({ id, s: scores[i] })));
      findable = target.some(id => fullCardRow.has(id));
      exact = rankIn(cards, id => id === labelId);
      dup = rankIn(cards, id => target.includes(id));
    } else {
      const scores = scoreRows(vectors, small[variant], small.rows.length);
      cards = small.rows.map((r: any, i: number) => ({ id: r.id, s: scores[i] }));
      const keyOf = (id: number) => { const c = prodById.get(id); return c && identity(c.name, c.cardNumber, c.variation, c.setName); };
      const labelKey = keyOf(labelId), targetKeys = new Set(target.map(keyOf));
      const rowKey = new Map(small.rows.map((r: any) => [r.id, r.key]));
      findable = small.rows.some((r: any) => targetKeys.has(r.key));
      exact = rankIn(cards, id => rowKey.get(id) === labelKey);
      dup = rankIn(cards, id => targetKeys.has(rowKey.get(id)));
    }
    return { findable, exact, dup, ...top(cards), searchMs: performance.now() - t, credited: duplicatesOf(labelId) };
  }

  const singles = items.filter(i => i.kind === 'single');
  const results: any[] = [];
  for (const arm of ARMS) {
    for (const item of singles) {
      const bytes = await fs.readFile(path.join(C0, item.file));
      const t = performance.now();
      const vectors = await arm.query(bytes);
      const embedMs = performance.now() - t;
      for (const index of ['small', 'full'] as const) {
        const r = search(index, arm.variant, vectors, item.cardId);
        results.push({ arm: arm.name, index, batch: item.batch, photo: item.id, cardId: item.cardId, tags: item.tags, embedMs, ms: embedMs + r.searchMs, ...r });
      }
    }
    console.log(`done arm ${arm.name}`);
  }

  // Product selection (§3): best of B/C on I-full singles, duplicate-corrected Top-3, then Top-1, then lower p95.
  const summarize = (arm: string, index: string) => {
    const rows = results.filter(r => r.arm === arm && r.index === index && r.findable);
    const at = (key: 'exact' | 'dup', k: number) => rows.filter(r => r[key] && r[key] <= k).length;
    const ms = results.filter(r => r.arm === arm && r.index === index).slice(1).map(r => r.ms).sort((a, b) => a - b);
    return { n: rows.length, exact: [1, 3, 5, 10].map(k => at('exact', k)), dup: [1, 3, 5, 10].map(k => at('dup', k)),
      msMedian: ms[Math.floor(ms.length / 2)], msP95: ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)] };
  };
  const [sB, sC] = [summarize('B', 'full'), summarize('C', 'full')];
  const best = (sB.dup[1] !== sC.dup[1] ? sB.dup[1] > sC.dup[1] : sB.dup[0] !== sC.dup[0] ? sB.dup[0] > sC.dup[0] : sB.msP95 <= sC.msP95) ? 'B' : 'C';
  const bestArm = ARMS.find(a => a.name === best)!;

  // Binder pages (§5, report-only).
  const binder: any[] = [];
  for (const page of items.filter(i => i.kind === 'binder')) {
    const bytes = await fs.readFile(path.join(C0, page.file));
    const t0 = performance.now();
    const { data, info } = await sharp(bytes).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (page.pageCorners as [number, number][]).map(([x, y]) => [x * info.width, y * info.height]);
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const pageW = (d(px[0], px[1]) + d(px[3], px[2])) / 2, pageH = (d(px[0], px[3]) + d(px[1], px[2])) / 2;
    const W = pageW >= pageH ? 2100 : Math.round(2100 * pageW / pageH), H = pageH > pageW ? 2100 : Math.round(2100 * pageH / pageW);
    const h = homography(px, [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]]);
    const out = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const z = h[6] * x + h[7] * y + h[8], u = (h[0] * x + h[1] * y + h[2]) / z, v = (h[3] * x + h[4] * y + h[5]) / z;
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      for (let ch = 0; ch < 3; ch++) {
        const at = (xx: number, yy: number) => data[(Math.min(info.height - 1, Math.max(0, yy)) * info.width + Math.min(info.width - 1, Math.max(0, xx))) * 3 + ch];
        out[(y * W + x) * 3 + ch] = Math.round(at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy);
      }
    }
    const warpMs = performance.now() - t0;
    const warped = sharp(out, { raw: { width: W, height: H, channels: 3 } });
    const cells: any[] = [];
    let cellsMs = 0, cellsNoTtaMs = 0;
    for (let i = 0; i < 9; i++) {
      const cw = W / 3, ch = H / 3, inset = 0.03;
      const left = Math.round((i % 3) * cw + cw * inset), top = Math.round(Math.floor(i / 3) * ch + ch * inset);
      const crop = await padToCardAspect(await warped.clone().extract({ left, top, width: Math.round(cw * (1 - 2 * inset)), height: Math.round(ch * (1 - 2 * inset)) }).png().toBuffer());
      const label = page.cells[i];
      let t = performance.now();
      const vectors = await bestArm.query(crop);
      let withTta: any;
      if (label) withTta = search('full', bestArm.variant, vectors, label);
      else { // empty pocket: record the top-1 score only (empty-pocket separation, report-only)
        const sc = scoreRows(vectors, full[bestArm.variant], full.rows.length);
        withTta = top(full.rows.flatMap((r, ri) => r.cardIds.map(id => ({ id, s: sc[ri] }))));
      }
      cellsMs += performance.now() - t;
      t = performance.now();
      const plain = NO_TTA[best];
      const v2 = await plain.query(crop);
      const noTta = label ? search('full', plain.variant, v2, label) : null;
      cellsNoTtaMs += performance.now() - t;
      cells.push({ cell: i, label, withTta, noTta });
    }
    binder.push({ page: page.id, warpMs, cellsMs, cellsNoTtaMs, pageMs: warpMs + cellsMs, pageNoTtaMs: warpMs + cellsNoTtaMs, size: [W, H], cells });
    console.log(`done binder page ${page.id.slice(0, 8)}`);
  }

  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
  await fs.mkdir(path.join(C0, 'results'), { recursive: true });
  await fs.writeFile(path.join(C0, 'results', 'runs.json'), JSON.stringify({ createdAt: new Date().toISOString(), commit, model: MODEL_VERSION,
    freezes, freezeLabelsSha256: freeze.labelsSha256, fullIndexRows: full.rows.length, fullIndexManifestHash: fullIndex.manifestHash,
    smallIndexRows: small.rows.length, summary: Object.fromEntries(['A', 'B', 'C'].flatMap(a => ['small', 'full'].map(ix => [`${a}/${ix}`, summarize(a, ix)]))),
    bestOfBC: best, results, binder }, null, 1));
  console.log(JSON.stringify({ bestOfBC: best, summaryFull: { A: summarize('A', 'full'), B: sB, C: sC } }));
}

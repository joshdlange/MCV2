// DEV-ONLY Phase C1 harness (docs/scan-plan-phase-c1.md, incl. Addendum A).
// Modes:
//   run     verify freezes + cells, V sanity check vs C0, then T/V/F/F+R on 30 singles and 36 cells;
//           writes MCV_DEV_DATA/phase-c1/results/raw.json (label-independent rankings + timings)
//   score   frozen/suggested labels x leakage none/all-candidates; writes results/scores.json
// T calls OpenAI (owner-approved: their own photos) and a throwaway LOCAL Postgres loaded from the
// production snapshot. No other database, no production access.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import OpenAI from 'openai';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { devDataPath } from '../server/devData';
import { embedCatalogVisualImage, MODEL_VERSION } from '../server/services/catalogVisualModel';
import { scanCard, identifyCardWithVision } from '../server/services/scanService';
import { retrieveCandidates, rankScanCandidates, sanitizeParsedScan, scanFamilyKey, type ParsedScan } from '../server/services/scanMatching';
import { cards, cardSets, mainSets } from '../shared/schema';
import { cutPageCells } from './dev-phase-c1-cells';
import { LOCAL_DB } from './dev-phase-c1-localdb';

process.umask(0o077);
process.env.CATALOG_VISUAL_OFFLINE = 'true';
const C0 = devDataPath('phase-c0'), C1 = devDataPath('phase-c1');
const DIM = 384, K = 10, ROTATE_BELOW = 0.85;
const PRICE = { input: 0.15 / 1e6, output: 0.60 / 1e6 }; // gpt-4o-mini list price, unverified (§3)
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const mode = process.argv[2];
const SUGGESTED: Record<string, number> = { // Addendum A: unconfirmed
  '19627bee-f68d-4a87-bd10-117b92b5d078': 548416,
  '3b12ef57-91a0-40c0-91a8-fcb1ee500573': 533722,
};

// ---------- catalog (production snapshot) ----------
const prodCards: any[] = (await read(path.join(C0, 'prod-catalog/cards.json'))).cards;
const prodById = new Map<number, any>(prodCards.map(c => [c.id, c]));
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isBaseSet = (setName: unknown, mainSetName: unknown) =>
  norm(setName).replace(norm(mainSetName), '').replace(/(19|20)\d\d/g, '').replace('base', '') === '';
const dupKey = (c: any) => [c.mainSetId, norm(c.cardNumber), norm(c.name), norm(c.variation)].join('|');
const baseByKey = new Map<string, number[]>();
for (const c of prodCards) if (!c.archived && c.setActive && isBaseSet(c.setName, c.mainSetName)) {
  const k = dupKey(c); baseByKey.set(k, [...(baseByKey.get(k) ?? []), c.id]);
}
const duplicatesOf = (id: number): number[] => { // C0 §4 rule, unchanged
  const c = prodById.get(id);
  if (!c || !isBaseSet(c.setName, c.mainSetName)) return [];
  return (baseByKey.get(dupKey(c)) ?? []).filter(x => x !== id);
};
const familyCache = new Map<number, string | null>();
const familyOf = (id: number) => familyCache.has(id) ? familyCache.get(id)! : familyCache.set(id, familyKeyOf(id)).get(id)!;
function familyKeyOf(id: number) { // existing product family key (§4)
  const c = prodById.get(id);
  return c ? scanFamilyKey({ id: c.id, name: c.name, cardNumber: c.cardNumber ?? '', frontImageUrl: c.imageUrl, variation: c.variation,
    isInsert: false, setName: c.setName, setYear: c.year, mainSetName: c.mainSetName, isInsertSubset: false } as any) : null;
}

// ---------- I-full ----------
const fullDir = path.join(C0, 'index-prod');
const fullIndex = await read(path.join(fullDir, 'index.json'));
const rows: { cardIds: number[] }[] = fullIndex.rows;
const vecBuf = await fs.readFile(path.join(fullDir, 'current.f32'));
const matrix = new Float32Array(vecBuf.buffer, vecBuf.byteOffset, vecBuf.byteLength / 4);
assert.equal(matrix.length, rows.length * DIM);
const indexedCards = new Set(rows.flatMap(r => r.cardIds));

async function centerCrop(buffer: Buffer, fraction: number) { // C0 verbatim
  const img = sharp(await sharp(buffer).rotate().toBuffer());
  const { width = 0, height = 0 } = await img.metadata();
  const w = Math.round(width * fraction), h = Math.round(height * fraction);
  return img.extract({ left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h }).toBuffer();
}
const armC = async (b: Buffer) => Promise.all([b, await centerCrop(b, 0.85), await centerCrop(b, 0.7)].map(x => embedCatalogVisualImage(x)));
function scoreRows(vectors: number[][]) { // C0 verbatim (max over the query's vectors)
  const scores = new Float32Array(rows.length).fill(-Infinity);
  for (const q of vectors) for (let r = 0; r < rows.length; r++) {
    let dot = 0; const o = r * DIM;
    for (let d = 0; d < DIM; d++) dot += q[d] * matrix[o + d];
    if (dot > scores[r]) scores[r] = dot;
  }
  return scores;
}
// Card-level ranking, ties by lower card ID (C0 §4).
function visualList(vectors: number[][]) {
  const s = scoreRows(vectors);
  const list: { id: number; s: number }[] = [];
  rows.forEach((r, i) => r.cardIds.forEach(id => list.push({ id, s: s[i] })));
  return list.sort((a, b) => b.s - a.s || a.id - b.id);
}

// ---------- T: live text pipeline against the local snapshot DB ----------
const localPool = new pg.Pool({ ...LOCAL_DB, max: 10 });
const localDb = drizzle(localPool);
const fetchRows = (condition: any, limit: number) => localDb.select({ // retrieveCandidates' default select, verbatim, local DB
  id: cards.id, name: cards.name, cardNumber: cards.cardNumber, frontImageUrl: cards.frontImageUrl,
  variation: cards.variation, isInsert: cards.isInsert, setName: cardSets.name, setYear: cardSets.year,
  mainSetName: mainSets.name, isInsertSubset: cardSets.isInsertSubset,
}).from(cards).innerJoin(cardSets, eq(cards.setId, cardSets.id)).leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id))
  .where(condition).orderBy(cards.id).limit(limit) as any;
async function matchMetadata(parsed: ParsedScan) { // matchCandidates' body, verbatim, with the local fetchRows
  parsed = sanitizeParsedScan(parsed);
  const hasSignal = parsed.characterName || parsed.cardNumber || parsed.setName || parsed.keywords.length > 0;
  if (!hasSignal) return [];
  const candidates = await retrieveCandidates(parsed, fetchRows);
  if (candidates.length === 0) return [];
  return rankScanCandidates(candidates, parsed);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function runT(bytes: Buffer, mime: string) {
  const calls: any[] = [];
  const client = { chat: { completions: { create: async (body: any, opts: any) => {
    const t = performance.now();
    try {
      const r: any = await openai.chat.completions.create(body, opts);
      calls.push({ ms: performance.now() - t, usage: r.usage, model: r.model });
      return r;
    } catch (e: any) { calls.push({ ms: performance.now() - t, error: String(e?.status ?? e?.code ?? e?.name ?? e) }); throw e; }
  } } } } as any;
  const t0 = performance.now();
  const result = await scanCard(bytes, mime, undefined, {
    visualRetrieval: false, artVerification: false, matchMetadata,
    identify: (b, m, back) => identifyCardWithVision(b, m, back, client),
  });
  return { ms: performance.now() - t0, calls, parsed: result.parsed, ocrText: result.ocrText, timings: result.timings,
    matches: result.matches.map(m => ({ cardId: m.cardId, confidence: m.confidence, reasons: m.matchReasons })) };
}
const transient = (t: any) => t.calls.some((c: any) => c.error && !/^4(0[0-9]|1[0-9]|2[0-8])$/.test(c.error));

// ---------- F: fusion rule (§3.1) ----------
const strongText = (m: any) => m.reasons.some((r: string) => r.startsWith('Exact card number match'))
  && m.reasons.some((r: string) => r.startsWith('Character/card name matched'));
function fuse(vList: { id: number }[], tMatches: any[]) {
  const vTop = vList.slice(0, K), tIds = tMatches.map(m => m.cardId);
  const out: number[] = [], seen = new Set<number>();
  const add = (id: number) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  vTop.filter(v => tIds.includes(v.id)).forEach(v => add(v.id));      // 1 agreement, visual order
  tMatches.filter(strongText).forEach(m => add(m.cardId));              // 2 strong text, T order
  vTop.forEach(v => add(v.id));                                         // 3 rest of V-top
  tIds.forEach(add);                                                    // 4 rest of T
  return { head: out, seen };                                           // 5 rest of V-list (implicit)
}
// First 1-based position where pred holds in head ++ (vList minus head); null if never.
function rankIn(head: number[], seen: Set<number>, vList: { id: number }[] | null, pred: (id: number) => boolean) {
  const i = head.findIndex(pred);
  if (i >= 0) return i + 1;
  if (!vList) return null;
  let pos = head.length;
  for (const v of vList) { if (seen.has(v.id)) continue; pos++; if (pred(v.id)) return pos; }
  return null;
}
function ranksFor(label: number, lists: { V: any[]; R: any[] | null; T: any[] }) {
  const targets = { exact: (id: number) => id === label,
    dup: ((ids: Set<number>) => (id: number) => ids.has(id))(new Set([label, ...duplicatesOf(label)])),
    family: ((f: string | null) => (id: number) => id === label || (!!f && familyOf(id) === f))(familyOf(label)) };
  const out: any = {};
  const F = fuse(lists.V, lists.T), FR = lists.R ? fuse(lists.R, lists.T) : F;
  const tHead = lists.T.map(m => m.cardId);
  for (const [k, pred] of Object.entries(targets)) {
    out[k] = {
      T: rankIn(tHead, new Set(tHead), null, pred),
      V: rankIn([], new Set(), lists.V, pred),
      F: rankIn(F.head, F.seen, lists.V, pred),
      FR: rankIn(FR.head, FR.seen, lists.R ?? lists.V, pred),
    };
  }
  return out;
}

async function rotations(bytes: Buffer) {
  const upright = await sharp(bytes).rotate().toBuffer();
  return [bytes, ...await Promise.all([90, 180, 270].map(deg => sharp(upright).rotate(deg).jpeg({ quality: 95 }).toBuffer()))];
}
// One query: T and the visual side concurrently (§4 latency). Returns label-independent rankings.
async function query(bytes: Buffer, mime: string) {
  const t0 = performance.now();
  let vEnd = 0, rEnd = 0;
  const visual = (async () => {
    const vectors = await armC(bytes);
    const V = visualList(vectors);
    vEnd = performance.now();
    let R: typeof V | null = null;
    if (V[0].s < ROTATE_BELOW) {
      const rot = await rotations(bytes);
      const more: number[][] = [];
      for (const r of rot.slice(1)) more.push(...await armC(r)); // inference is serial (one ONNX call at a time)
      R = visualList([...vectors, ...more]);
    }
    rEnd = performance.now();
    return { V, R };
  })();
  let T = await runT(bytes, mime);
  const tEnd = performance.now();
  const { V, R } = await visual;
  let retried = null;
  if (transient(T)) { retried = T; T = await runT(bytes, mime); } // §3 retry rule; timing from the first attempt
  const f0 = performance.now(); fuse(V, T.matches); if (R) fuse(R, T.matches); const fusionMs = performance.now() - f0;
  return {
    V, R, T, retried,
    vTop1: V[0], rTop1: R?.[0] ?? null, rotated: !!R,
    ms: { T: T.ms, V: vEnd - t0, VR: rEnd - t0, F: Math.max(tEnd, vEnd) - t0 + fusionMs, FR: Math.max(tEnd, rEnd) - t0 + fusionMs },
  };
}
const slim = (q: any, labels: number[]) => ({
  T: { matches: q.T.matches, parsed: q.T.parsed, ocrText: q.T.ocrText, calls: q.T.calls, timings: q.T.timings },
  retried: q.retried && { calls: q.retried.calls, matches: q.retried.matches },
  rotated: q.rotated, vTop: q.V.slice(0, 10), rTop: q.R?.slice(0, 10) ?? null,
  fTop: fuse(q.V, q.T.matches).head.slice(0, 10), frTop: fuse(q.R ?? q.V, q.T.matches).head.slice(0, 10),
  ms: q.ms, ranks: Object.fromEntries(labels.map(l => [l, ranksFor(l, { V: q.V, R: q.R, T: q.T.matches })])),
});
const mimeOf = (file: string) => file.endsWith('.webp') ? 'image/webp' : file.endsWith('.png') ? 'image/png' : 'image/jpeg';

if (mode === 'run') {
  // Freeze check (C0 harness logic).
  const all: any[] = await read(path.join(C0, 'labels.json'));
  const items: any[] = [];
  for (const [b, f] of [[1, 'freeze.json'], [2, 'freeze-batch2.json']] as const) {
    const fr = await read(path.join(C0, f));
    const batchItems = fr.photos.map((p: any) => all.find(i => i.id === p.id));
    assert.equal(sha(JSON.stringify(batchItems, null, 2)), fr.labelsSha256, `batch ${b}: labels changed after the freeze`);
    for (const p of fr.photos) assert.equal(sha(await fs.readFile(path.join(C0, p.file))), p.sha256, `batch ${b}: photo ${p.id} changed`);
    items.push(...batchItems.map((i: any) => ({ ...i, batch: b })));
  }
  assert.equal(items.length, all.length, 'every item is frozen');
  const cellsMeta: any[] = await read(path.join(C1, 'cells', 'cells.json'));
  assert.equal(sha(JSON.stringify(cellsMeta)), '9607d1d994f316e04a4ff90ef745bc88b98c09c8e3527788d1b1401f68f5ac1f', 'cells.json changed');
  const c0 = await read(path.join(C0, 'results', 'runs.json'));
  const SMOKE = process.argv.includes('--smoke'); // 1 single, no binder, separate output file
  const singles = items.filter(i => i.kind === 'single').slice(0, SMOKE ? 2 : undefined);
  const labelsOf = (photo: string, frozen: number) => [...new Set([frozen, SUGGESTED[photo]].filter(Boolean))];

  const out: any = { createdAt: new Date().toISOString(), model: MODEL_VERSION, K, ROTATE_BELOW, suggested: SUGGESTED, singles: [], binder: [] };
  try { out.commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
  for (const item of singles) {
    const bytes = await fs.readFile(path.join(C0, item.file));
    const q = await query(bytes, mimeOf(item.file));
    const c0r = c0.results.find((r: any) => r.arm === 'C' && r.index === 'full' && r.photo === item.id);
    const r = slim(q, labelsOf(item.id, item.cardId));
    // V sanity check vs C0 arm C / full (§3): identical exact and dup ranks for the frozen label.
    const v = r.ranks[item.cardId];
    assert.equal(c0r.findable ? v.exact.V : null, c0r.exact, `V differs from C0 for ${item.id} (exact)`);
    assert.equal(c0r.findable ? v.dup.V : null, c0r.dup, `V differs from C0 for ${item.id} (dup)`);
    out.singles.push({ photo: item.id, batch: item.batch, cardId: item.cardId, tags: item.tags, ...r });
    console.log(`single ${item.id.slice(0, 8)} T=${Math.round(q.ms.T)}ms F=${Math.round(q.ms.F)}ms rot=${q.rotated}`);
  }
  for (const page of items.filter(i => i.kind === 'binder' && !SMOKE)) {
    const bytes = await fs.readFile(path.join(C0, page.file));
    const p0 = performance.now();
    const cut = await cutPageCells(bytes, page.pageCorners);
    cut.cells.forEach((c, i) => assert.equal(sha(c), cellsMeta.find(m => m.page === page.id && m.cell === i).sha256, `cell ${i} differs`));
    // 9 T calls concurrently; visual work sequential alongside (§5).
    const visual = (async () => {
      const res: any[] = [];
      for (const cell of cut.cells) {
        const vectors = await armC(cell);
        const V = visualList(vectors);
        let R = null;
        if (V[0].s < ROTATE_BELOW) {
          const more: number[][] = [];
          for (const r of (await rotations(cell)).slice(1)) more.push(...await armC(r));
          R = visualList([...vectors, ...more]);
        }
        res.push({ V, R });
      }
      return res;
    })();
    const Ts = await Promise.all(cut.cells.map(c => runT(c, 'image/jpeg')));
    const vis = await visual;
    const pageMs = performance.now() - p0;
    const cells = [];
    for (let i = 0; i < 9; i++) {
      let T = Ts[i], retried = null;
      if (transient(T)) { retried = T; T = await runT(cut.cells[i], 'image/jpeg'); }
      const q = { ...vis[i], T, retried, rotated: !!vis[i].R, ms: { T: Ts[i].ms } };
      cells.push({ cell: i, label: page.cells[i], ...slim(q, page.cells[i] ? [page.cells[i]] : []) });
    }
    out.binder.push({ page: page.id, warpMs: cut.warpMs, pageMs, cells });
    console.log(`page ${page.id.slice(0, 8)} ${Math.round(pageMs)}ms`);
  }
  await localPool.end();
  await fs.mkdir(path.join(C1, 'results'), { recursive: true });
  const raw = JSON.stringify(out, null, 1);
  await fs.writeFile(path.join(C1, 'results', SMOKE ? 'raw-smoke.json' : 'raw.json'), raw);
  console.log(JSON.stringify({ singles: out.singles.length, cells: out.binder.reduce((s: number, p: any) => s + p.cells.length, 0), sha256: sha(raw) }));
  process.exit(0);
}

if (mode === 'score') {
  const raw = await read(path.join(C1, 'results', 'raw.json'));
  const uploader = (id: number) => prodById.get(id)?.imageUrl?.match(/\/user_uploads\/(\d+)\//)?.[1] ?? null;
  const arms = ['T', 'V', 'F', 'FR'] as const, kinds = ['exact', 'dup', 'family'] as const;
  const pct = (a: number, n: number) => n ? Math.round(1000 * a / n) / 10 : null;
  const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)]; };
  const singleRows = (labelSet: 'frozen' | 'suggested') => raw.singles.map((s: any) => {
    const label = labelSet === 'suggested' && SUGGESTED[s.photo] ? SUGGESTED[s.photo] : s.cardId;
    return { ...s, label, leakCandidate: !!uploader(label), hasImage: indexedCards.has(label), r: s.ranks[label] };
  });
  const summarize = (rs: any[]) => {
    const o: any = { n: rs.length };
    for (const k of kinds) for (const a of arms) {
      const at = (n: number) => rs.filter(r => r.r[k][a] !== null && r.r[k][a] <= n).length;
      o[`${k}.${a}`] = { top1: at(1), top3: at(3), top5: at(5), top10: at(10) };
    }
    return o;
  };
  const timed = raw.singles.slice(1); // first query is warm-up (C0 §4)
  const latency = Object.fromEntries(['T', 'V', 'VR', 'F', 'FR'].map(a => [a, { p50: quant(timed.map((s: any) => s.ms[a]), 0.5), p95: quant(timed.map((s: any) => s.ms[a]), 0.95) }]));
  const combos: any = {};
  for (const labelSet of ['frozen', 'suggested'] as const) for (const leak of ['none', 'all-candidates'] as const) {
    const rs = singleRows(labelSet).filter((r: any) => leak === 'none' || !r.leakCandidate);
    const by = (b: number | null) => summarize(b ? rs.filter((r: any) => r.batch === b) : rs);
    const comb = by(null);
    const verdict = (a: 'F' | 'FR') => {
      const f = comb[`family.${a}`];
      const ok = { top3Ok: f.top3 / comb.n >= 0.85, top1Ok: f.top1 / comb.n >= 0.70, p95Ok: latency[a].p95 <= 2500 };
      return { top1: `${f.top1}/${comb.n} (${pct(f.top1, comb.n)}%)`, top3: `${f.top3}/${comb.n} (${pct(f.top3, comb.n)}%)`, p95ms: Math.round(latency[a].p95), ...ok, pass: ok.top1Ok && ok.top3Ok && ok.p95Ok };
    };
    const vF = verdict('F'), vFR = verdict('FR');
    combos[`${labelSet}/${leak}`] = { excluded: singleRows(labelSet).filter((r: any) => leak !== 'none' && r.leakCandidate).map((r: any) => r.photo),
      batch1: by(1), batch2: by(2), combined: comb, verdict: { F: vF, FR: vFR, pass: vF.pass || vFR.pass },
      noImage: summarize(rs.filter((r: any) => !r.hasImage)) };
  }
  // Binder (report-only), frozen labels (the binder labels have no suggested corrections).
  const cellRows = raw.binder.flatMap((p: any) => p.cells.filter((c: any) => c.label).map((c: any) => ({ ...c, page: p.page,
    hasImage: indexedCards.has(c.label), leakCandidate: !!uploader(c.label), r: c.ranks[c.label],
    position: c.cell === 4 ? 'centre' : [0, 2, 6, 8].includes(c.cell) ? 'corner' : 'edge' })));
  const binder = { all: summarize(cellRows), withImage: summarize(cellRows.filter((c: any) => c.hasImage)),
    withImageNoLeak: summarize(cellRows.filter((c: any) => c.hasImage && !c.leakCandidate)),
    noImage: summarize(cellRows.filter((c: any) => !c.hasImage)),
    byPosition: Object.fromEntries(['centre', 'edge', 'corner'].map(p => [p, summarize(cellRows.filter((c: any) => c.position === p && c.hasImage))])),
    pages: raw.binder.map((p: any) => ({ page: p.page, warpMs: p.warpMs, pageMs: p.pageMs })) };
  const calls = [...raw.singles, ...raw.binder.flatMap((p: any) => p.cells)].flatMap((x: any) => [...x.T.calls, ...(x.retried?.calls ?? [])]);
  const tokens = calls.reduce((s: any, c: any) => ({ input: s.input + (c.usage?.prompt_tokens ?? 0), output: s.output + (c.usage?.completion_tokens ?? 0) }), { input: 0, output: 0 });
  const cost = { calls: calls.length, errors: calls.filter((c: any) => c.error).length, ...tokens, usd: tokens.input * PRICE.input + tokens.output * PRICE.output };
  const scores = { rawSha256: sha(await fs.readFile(path.join(C1, 'results', 'raw.json'))), latency, combos, binder, cost,
    rotatedSingles: raw.singles.filter((s: any) => s.rotated).length, rotatedCells: raw.binder.flatMap((p: any) => p.cells).filter((c: any) => c.rotated).length };
  await fs.writeFile(path.join(C1, 'results', 'scores.json'), JSON.stringify(scores, null, 1));
  console.log(JSON.stringify({ latency, verdicts: Object.fromEntries(Object.entries(combos).map(([k, v]: any) => [k, v.verdict])), cost }, null, 1));
  process.exit(0);
}

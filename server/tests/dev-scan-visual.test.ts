import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { devDataPath } from '../devData';
import { MODEL_VERSION, VECTOR_DIMENSIONS, embedCatalogVisualImage, bundledVisualModelPath } from '../services/catalogVisualModel';
import { scanFamilyKey } from '../services/scanMatching';
import {
  DevScanVisualService, isDevScanVisualEnabled, validateDevScanIndex, scoreDevScanRows,
  loadDevScanFrozenIndex, devScanCenterCrop, initializeDevScanVisual,
  type DevScanCatalogCard, type DevScanFrozenIndex,
} from '../services/devScanVisual';

const enabled = { NODE_ENV: 'development', SCAN_VISUAL_RETRIEVAL: 'on' };
const vector = (d: number) => Array.from({ length: VECTOR_DIMENSIONS }, (_, i) => i === d ? 1 : 0);
const card = (id: number, name = `Card ${id}`, active = true): DevScanCatalogCard => ({
  id, name, active, cardNumber: '1', frontImageUrl: null, variation: null, isInsert: false,
  setName: 'Base', mainSetName: 'Test set', setYear: 2026, isInsertSubset: false,
});
function fixture(n = 7) {
  const index: DevScanFrozenIndex = {
    model: MODEL_VERSION, indexed: n, manifestCount: n, missing: 0,
    rows: Array.from({ length: n }, (_, k) => ({ k, cardIds: [k + 1] })),
  };
  const matrix = Float32Array.from(Array.from({ length: n }, (_, i) => vector(i)).flat());
  const catalog = Array.from({ length: n }, (_, i) => card(i + 1));
  return { index, matrix, catalog };
}

test('replacement removes old card vector, updates displayed reference and supports first images', () => {
  const f = fixture(3);
  f.index.rows[0].cardIds.push(4);
  f.catalog.push(card(4), card(5));
  const service = new DevScanVisualService(f.index, f.matrix, f.catalog, undefined, 4, enabled);
  assert.equal(service.rankVectors([vector(0)]).rankedCardIds![0], 1);
  service.setReferenceOverride(1, 'https://example.com/new.jpg', vector(2));
  const oldQuery = service.rankVectors([vector(0)]);
  assert.equal(oldQuery.rankedCardIds![0], 4, 'Shared-reference sibling retains its vector');
  assert.equal(oldQuery.matches.find(m => m.cardId === 1)?.imageSimilarity, 0);
  const newQuery = service.rankVectors([vector(2)]);
  assert.equal(newQuery.rankedCardIds![0], 1);
  assert.equal(newQuery.matches.find(m => m.cardId === 1)?.imageUrl, 'https://example.com/new.jpg');
  service.setReferenceOverride(5, 'https://example.com/first.jpg', vector(4));
  assert.equal(service.rankVectors([vector(4)]).rankedCardIds![0], 5);
  service.setReferenceOverride(1, 'https://example.com/changed-again.jpg', null);
  assert.ok(!service.rankVectors([vector(2)]).rankedCardIds!.includes(1), 'Stale override never reactivates frozen vector');
  assert.throws(() => service.setReferenceOverride(1, 'x', [1]), /Invalid/);
});
function make(embed?: (buffer: Buffer) => Promise<number[]>, maxWaiting = 4) {
  const { index, matrix, catalog } = fixture();
  return new DevScanVisualService(index, matrix, catalog, embed, maxWaiting, enabled);
}
const image = () => sharp({ create: { width: 40, height: 60, channels: 3, background: '#777777' } }).png().toBuffer();

test('strict development gate and disabled startup do no initialization', async () => {
  for (const NODE_ENV of [undefined, '', 'development', 'production', 'test']) {
    for (const REPLIT_DEPLOYMENT of [undefined, '', '1', 'false']) {
      for (const SCAN_VISUAL_RETRIEVAL of [undefined, '', 'on', 'off', 'ON', 'true']) {
        assert.equal(isDevScanVisualEnabled({ NODE_ENV, REPLIT_DEPLOYMENT, SCAN_VISUAL_RETRIEVAL }),
          NODE_ENV === 'development' && !REPLIT_DEPLOYMENT && SCAN_VISUAL_RETRIEVAL === 'on');
      }
    }
  }
  const { index, matrix, catalog } = fixture();
  assert.throws(() => new DevScanVisualService(index, matrix, catalog, undefined, 4, {}), /disabled/);
  if (!isDevScanVisualEnabled()) assert.equal(await initializeDevScanVisual(), undefined);
});

test('index validates model, byte/count lengths, IDs and finite unit vectors', () => {
  const { index, matrix } = fixture();
  validateDevScanIndex(index, matrix);
  assert.throws(() => validateDevScanIndex({ ...index, model: 'wrong' }, matrix), /model/);
  assert.throws(() => validateDevScanIndex(index, matrix.slice(1)), /length/);
  assert.throws(() => validateDevScanIndex({ ...index, missing: 1 }, matrix), /count/);
  for (const value of [NaN, Infinity, 0]) {
    const bad = matrix.slice(); bad[0] = value;
    assert.throws(() => validateDevScanIndex(index, bad), /finite|norm/);
  }
  const duplicate = structuredClone(index); duplicate.rows[1].cardIds = [1];
  assert.throws(() => validateDevScanIndex(duplicate, matrix), /duplicate/);
  const badRow = structuredClone(index); badRow.rows[0].k = 1;
  assert.throws(() => validateDevScanIndex(badRow, matrix), /row/);
});

test('load verifies existing verify.json and rejects corruption without writing frozen files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-scan-index-'));
  try {
    const { index, matrix } = fixture();
    const json = Buffer.from(JSON.stringify(index)), bytes = Buffer.from(matrix.buffer);
    const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    await fs.writeFile(path.join(dir, 'index.json'), json);
    await fs.writeFile(path.join(dir, 'current.f32'), bytes);
    await loadDevScanFrozenIndex(dir); // verify.json is optional, not other validation.
    const verify = {
      rows: index.indexed, manifestCount: index.manifestCount, missing: 0, badNorm: 0,
      currentSha256: hash(bytes), indexJsonSha256: hash(json),
    };
    await fs.writeFile(path.join(dir, 'verify.json'), JSON.stringify(verify));
    assert.deepEqual((await loadDevScanFrozenIndex(dir)).matrix, matrix);
    await fs.writeFile(path.join(dir, 'verify.json'), JSON.stringify({ ...verify, currentSha256: 'wrong' }));
    await assert.rejects(loadDevScanFrozenIndex(dir), /checksum/);
    await fs.writeFile(path.join(dir, 'current.f32'), bytes.subarray(1));
    await assert.rejects(loadDevScanFrozenIndex(dir), /byte length/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('max-dot search groups top five distinct active families with all no-image options', () => {
  const { index, matrix, catalog } = fixture();
  catalog[1] = { ...card(2, 'Card 1'), variation: 'Gold' };
  catalog[6].active = false;
  catalog.push({ ...card(8, 'Card 1'), variation: 'Silver' }, card(9, 'Card 1', false));
  const service = new DevScanVisualService(index, matrix, catalog, undefined, 4, enabled);
  const result = service.rankVectors([vector(0), vector(1), vector(6)]);
  assert.equal(result.families.length, 5);
  assert.equal(new Set(result.families.map(f => f.familyKey)).size, 5);
  assert.equal(result.families[0].familyKey, scanFamilyKey(catalog[0]));
  assert.equal(result.families[0].representativeCardId, 1); // tie: smaller card ID
  assert.deepEqual(result.families[0].options.map(o => o.cardId), [1, 2, 8]);
  assert.equal(result.families[0].options[2].retrievalSource, 'image-family');
  assert.equal(result.families[0].options[2].imageUrl, null);
  assert.equal(result.topScore, 1);
  assert.equal(result.margin, 1);
  assert.ok(result.matches.every(m => m.cardId !== 7 && m.cardId !== 9));
  assert.deepEqual(result.matches, result.families.flatMap(f => f.options));
});

test('catalog mismatch fails at startup; single-family margin is explicitly null', () => {
  const { index, matrix, catalog } = fixture(1);
  assert.throws(() => new DevScanVisualService(index, matrix, [], undefined, 4, enabled), /missing from DEV/);
  const service = new DevScanVisualService(index, matrix, catalog, undefined, 4, enabled);
  assert.equal(service.rankVectors([vector(0)]).margin, null);
  assert.throws(() => scoreDevScanRows([[NaN]], matrix, 1), /query vector/);
  assert.throws(() => scoreDevScanRows([new Array(384).fill(0)], matrix, 1), /norm/);
});

test('C0 crop rounding preserves exact dimensions and request embeds original + 85% + 70%', async () => {
  const bytes = await image();
  const sizes: number[][] = [];
  const service = make(async b => {
    const meta = await sharp(b).metadata();
    sizes.push([meta.width!, meta.height!]);
    return vector(sizes.length - 1);
  });
  const result = await service.scan(bytes);
  assert.deepEqual(sizes, [[40, 60], [34, 51], [28, 42]]);
  assert.ok(Object.values(result.timings).every(t => Number.isFinite(t) && t >= 0));
  assert.ok(result.timings.totalMs >= result.timings.embeddingMs);
  const meta = await sharp(await devScanCenterCrop(bytes, 0.85)).metadata();
  assert.equal(meta.width, 34);
  await assert.rejects(service.scan(Buffer.alloc(0)), /1 byte/);
  await assert.rejects(service.scan(Buffer.alloc(12 * 1024 * 1024 + 1)), /12 MB/);
});

test('whole-request queue is bounded and serialized and recovers after errors', async () => {
  const bytes = await image();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let calls = 0, active = 0, maxActive = 0;
  const service = make(async () => {
    active++; maxActive = Math.max(maxActive, active); calls++;
    await hold;
    active--;
    return vector(0);
  }, 1);
  const first = service.scan(bytes), second = service.scan(bytes);
  await assert.rejects(service.scan(bytes), /busy/);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 6);
  assert.equal(maxActive, 1);
  await service.scan(bytes);
  let attempt = 0;
  const recovering = make(async () => {
    if (++attempt === 1) throw new Error('explicit embedding failure');
    return vector(0);
  });
  const failed = recovering.scan(bytes), next = recovering.scan(bytes);
  await assert.rejects(failed, /explicit embedding failure/);
  assert.equal((await next).topScore, 1);
});

test('startup import remains behind strict guard; changed TypeScript parses', () => {
  for (const filename of ['server/index.ts', 'server/services/devScanVisual.ts', 'server/services/catalogVisualModel.ts']) {
    const text = readFileSync(filename, 'utf8');
    const parsed = ts.transpileModule(text, {
      fileName: filename, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    });
    assert.deepEqual(parsed.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  }
  assert.match(readFileSync('server/index.ts', 'utf8'),
    /if \(suppressAutomaticCatalogMutations\(\)\) \{\s*const \{ initializeDevScanTelemetry \} = await import\("\.\/services\/devScanTelemetry"\);\s*await initializeDevScanTelemetry\(\);\s*const \{ initializeDevScanVisual \} = await import\("\.\/services\/devScanVisual"\);\s*await initializeDevScanVisual\(\);/);
});

const localParityAvailable = existsSync(devDataPath('phase-c0', 'results', 'runs.json'))
  && existsSync(devDataPath('phase-c0', 'prod-catalog', 'cards.json'))
  && existsSync(devDataPath('phase-c0', 'index-prod', 'current.f32'))
  && existsSync(path.join(bundledVisualModelPath(), 'onnx', 'model_quantized.onnx'));
test('one local frozen photo: real offline C0 arm-C score and top-five family parity', {
  skip: !localParityAvailable, timeout: 120_000,
}, async () => {
  const runs = JSON.parse(await fs.readFile(devDataPath('phase-c0', 'results', 'runs.json'), 'utf8'));
  const expected = runs.results.find((r: any) => r.arm === 'C' && r.index === 'full');
  assert.ok(expected, 'C0 arm-C full-index result required');
  const labels = JSON.parse(await fs.readFile(devDataPath('phase-c0', 'labels.json'), 'utf8'));
  const label = labels.find((l: any) => l.id === expected.photo);
  const frozen = JSON.parse(await fs.readFile(devDataPath('phase-c0', 'freeze.json'), 'utf8'));
  const bytes = await fs.readFile(devDataPath('phase-c0', label.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    frozen.photos.find((p: any) => p.id === expected.photo).sha256);
  const { index, matrix } = await loadDevScanFrozenIndex();
  const snapshot = JSON.parse(await fs.readFile(devDataPath('phase-c0', 'prod-catalog', 'cards.json'), 'utf8'));
  const catalog = snapshot.cards.map((c: any): DevScanCatalogCard => ({
    id: c.id, name: c.name, cardNumber: c.cardNumber ?? '', variation: c.variation,
    frontImageUrl: c.imageUrl, isInsert: false, setName: c.setName, setYear: c.year,
    mainSetName: c.mainSetName, isInsertSubset: false, active: !c.archived && c.setActive,
  }));
  const captured: number[][] = [];
  const service = new DevScanVisualService(index, matrix, catalog, async b => {
    const v = await embedCatalogVisualImage(b, 'scan', { offline: true });
    captured.push(v);
    return v;
  }, 4, enabled);
  const actual = await service.scan(bytes);
  assert.equal(captured.length, 3);
  assert.equal(actual.families[0].representativeCardId, expected.top1Id);
  assert.ok(Math.abs(actual.topScore! - expected.top1Score) < 1e-6);
  // Independent C0 formula and card tie-break, then dedup by existing family key.
  const scores = new Float32Array(index.rows.length).fill(-Infinity);
  for (const q of captured) for (let r = 0; r < index.rows.length; r++) {
    let dot = 0;
    for (let d = 0; d < 384; d++) dot += q[d] * matrix[r * 384 + d];
    if (dot > scores[r]) scores[r] = dot;
  }
  const byId = new Map<number, DevScanCatalogCard>(catalog.map((c: DevScanCatalogCard) => [c.id, c]));
  const ranked = index.rows.flatMap((r, i) => r.cardIds.filter(id => byId.get(id)!.active)
    .map(id => ({ id, score: scores[i] }))).sort((a, b) => b.score - a.score || a.id - b.id);
  const families = new Map<string, { id: number; score: number }>();
  for (const hit of ranked) {
    const key = scanFamilyKey(byId.get(hit.id)!);
    if (!families.has(key)) families.set(key, hit);
    if (families.size === 5) break;
  }
  assert.deepEqual(actual.families.map(f => [f.familyKey, f.representativeCardId, f.score]),
    [...families].map(([key, hit]) => [key, hit.id, hit.score]));
  for (const family of actual.families) {
    assert.deepEqual(new Set(family.options.map(o => o.cardId)),
      new Set(catalog.filter((c: DevScanCatalogCard) => c.active && scanFamilyKey(c) === family.familyKey)
        .map((c: DevScanCatalogCard) => c.id)));
  }
});
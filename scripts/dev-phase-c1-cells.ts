// DEV-ONLY Phase C1: export the 36 binder cells exactly as the Phase C0 harness cut them
// (scripts/dev-phase-c0.ts @ 391623ed, §5 page geometry: warp, 3x3, 3% inset, gray pad to 5:7).
// The warp, homography and padding below are copied verbatim from that harness, which is not
// modified. Writes MCV_DEV_DATA/phase-c1/cells/<page>-<cell>.jpg and cells.json (hashes).
// Reads the frozen C0 photos only; no database, no network.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { devDataPath } from '../server/devData';

process.umask(0o077);
const C0 = devDataPath('phase-c0'), OUT = devDataPath('phase-c1', 'cells');
const GRAY = { r: 0x77, g: 0x77, b: 0x77 };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

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

const labels: any[] = JSON.parse(await fs.readFile(path.join(C0, 'labels.json'), 'utf8'));
const frozen = JSON.parse(await fs.readFile(path.join(C0, 'freeze.json'), 'utf8'));
await fs.mkdir(OUT, { recursive: true });
const cells: any[] = [];
for (const page of labels.filter(i => i.kind === 'binder')) {
  const bytes = await fs.readFile(path.join(C0, page.file));
  assert.equal(sha(bytes), frozen.photos.find((p: any) => p.id === page.id)?.sha256, `page ${page.id} is not the frozen photo`);
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
  const warped = sharp(out, { raw: { width: W, height: H, channels: 3 } });
  for (let i = 0; i < 9; i++) {
    const cw = W / 3, ch = H / 3, inset = 0.03;
    const left = Math.round((i % 3) * cw + cw * inset), top = Math.round(Math.floor(i / 3) * ch + ch * inset);
    const crop = await padToCardAspect(await warped.clone().extract({ left, top, width: Math.round(cw * (1 - 2 * inset)), height: Math.round(ch * (1 - 2 * inset)) }).png().toBuffer());
    const file = `${page.id}-${i}.jpg`;
    await fs.writeFile(path.join(OUT, file), crop);
    cells.push({ page: page.id, cell: i, label: page.cells[i], file, sha256: sha(crop) });
  }
  console.log(`page ${page.id.slice(0, 8)}: 9 cells`);
}
await fs.writeFile(path.join(OUT, 'cells.json'), JSON.stringify(cells, null, 2));
console.log(JSON.stringify({ cells: cells.length, hash: sha(JSON.stringify(cells)) }));

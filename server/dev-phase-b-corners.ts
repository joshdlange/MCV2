import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Express, RequestHandler } from 'express';
import { requireDevelopmentAdmin } from './services/scanReview';
import { isClockwiseConvex, orderCardCorners } from '../shared/cardCorners';

// DEV-ONLY Phase B corner marking for the frozen 41 scan photos. Registered only
// when NODE_ENV=development; every endpoint is also admin + development gated.
// Reads/writes .local/phase-b only (gitignored). No database access.
const root = path.resolve(process.cwd(), '.local/phase-b');
const base = '/api/admin/phase-b-corners';
type Point = [number, number];
type Case = { scanId: number; cardId: number; file: string };

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(path.join(root, name), 'utf8')); }
  catch (error: any) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
async function cases(): Promise<Case[]> { return readJson<Case[]>('cases.json', []); }

let writes: Promise<unknown> = Promise.resolve();
function saveCorners(scanId: number, corners: Point[]) {
  const write = writes.then(async () => {
    const all = await readJson<Record<string, unknown>>('corners.json', {});
    all[scanId] = { corners, order: 'TL,TR,BR,BL of the printed card (ordered by orderCardCorners)', space: 'normalized, EXIF-rotated', savedAt: new Date().toISOString() };
    const target = path.join(root, 'corners.json');
    await fs.writeFile(`${target}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
    await fs.rename(`${target}.tmp`, target);
    return all;
  });
  writes = write.catch(() => undefined);
  return write;
}

export function registerPhaseBCornerRoutes(app: Express, authenticateUser: RequestHandler) {
  if (process.env.NODE_ENV !== 'development') return;
  const guard = [authenticateUser, requireDevelopmentAdmin];

  app.get(base, ...guard, async (_req, res) => {
    try {
      const corners = await readJson<Record<string, { corners: Point[] }>>('corners.json', {});
      res.json((await cases()).map(c => ({ scanId: c.scanId, corners: corners[c.scanId]?.corners ?? null })));
    } catch { res.status(500).json({ message: 'Phase B cases unavailable' }); }
  });

  app.get(`${base}/image/:scanId`, ...guard, async (req, res) => {
    try {
      const item = (await cases()).find(c => c.scanId === Number(req.params.scanId));
      if (!item) return res.status(404).json({ message: 'Unknown scan' });
      const file = path.resolve(root, item.file);
      if (!file.startsWith(root + path.sep)) return res.status(404).json({ message: 'Unknown scan' });
      // Bake EXIF orientation into pixels so clicked coordinates match the harness.
      const bytes = await sharp(await fs.readFile(file)).rotate().jpeg({ quality: 90 }).toBuffer();
      res.set('Cache-Control', 'private, no-store');
      res.type('image/jpeg').send(bytes);
    } catch { res.status(500).json({ message: 'Image unavailable' }); }
  });

  app.put(`${base}/:scanId`, ...guard, async (req, res) => {
    try {
      const scanId = Number(req.params.scanId);
      if (!(await cases()).some(c => c.scanId === scanId)) return res.status(404).json({ message: 'Unknown scan' });
      const corners = req.body?.corners;
      const valid = Array.isArray(corners) && corners.length === 4 && corners.every((p: unknown) =>
        Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && v >= 0 && v <= 1));
      if (!valid) return res.status(400).json({ message: 'Expected 4 normalized [x, y] corners' });
      const ordered = orderCardCorners(corners);
      if (!isClockwiseConvex(ordered)) return res.status(400).json({ message: 'Corners do not form a convex card outline' });
      await saveCorners(scanId, ordered);
      res.json({ scanId, corners: ordered });
    } catch { res.status(500).json({ message: 'Could not save corners' }); }
  });
}

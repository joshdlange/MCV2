import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import multer from 'multer';
import type { Express, RequestHandler } from 'express';
import { devDataPath } from './devData';
import { requireDevelopmentAdmin } from './services/scanReview';
import { isClockwiseConvex, orderCardCorners, type CornerPoint } from '../shared/cardCorners';

// DEV-ONLY Phase C0 test-photo intake: the owner's own labelled phone photos.
// Registered only when NODE_ENV=development; every endpoint is development + admin gated.
// Photos and labels live under MCV_DEV_DATA/phase-c0 (default .local, gitignored).
// Card search and lookup read the frozen PRODUCTION catalog snapshot (Phase C0 addendum A)
// from a local file; this module never queries any database.
let root = devDataPath('phase-c0');
const catalogFile = () => path.join(root, 'prod-catalog', 'cards.json');
const base = '/api/admin/phase-c0';
const TAGS = ['hand', 'table', 'sleeve', 'toploader', 'glare', 'binder-neighbors', 'angle', 'low-light', 'clean'] as const;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

type Item = {
  id: string; kind: 'single' | 'binder'; file: string; createdAt: string; updatedAt: string;
  cardId?: number; tags?: string[]; note?: string;
  cells?: (number | null)[]; pageCorners?: CornerPoint[];
};

async function readItems(): Promise<Item[]> {
  try { return JSON.parse(await fs.readFile(path.join(root, 'labels.json'), 'utf8')); }
  catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
}
let writes: Promise<unknown> = Promise.resolve();
function mutate(change: (items: Item[]) => Item[] | Promise<Item[]>) {
  const write = writes.then(async () => {
    await fs.mkdir(path.join(root, 'photos'), { recursive: true, mode: 0o700 });
    const items = await change(await readItems());
    const target = path.join(root, 'labels.json');
    await fs.writeFile(`${target}.tmp`, JSON.stringify(items, null, 2), { mode: 0o600 });
    await fs.rename(`${target}.tmp`, target);
    return items;
  });
  writes = write.catch(() => undefined);
  return write;
}

type CatalogCard = { id: number; name: string; cardNumber: string | null; variation: string | null; setName: string;
  year: number | null; mainSetName: string | null; setActive: boolean; archived: boolean; imageUrl: string | null };
let catalog: Promise<{ byId: Map<number, CatalogCard>; rows: (CatalogCard & { text: string; number: string })[] }> | undefined;
const loadCatalog = () => catalog ??= fs.readFile(catalogFile(), 'utf8').then(raw => {
  const cards: CatalogCard[] = JSON.parse(raw).cards;
  const rows = cards.map(c => ({ ...c, text: `${c.name} ${c.setName} ${c.mainSetName ?? ''}`.toLowerCase(),
    number: String(c.cardNumber ?? '').toLowerCase().replace(/^[#0]+/, '') }));
  return { byId: new Map(cards.map(c => [c.id, c])), rows };
}).catch(error => { catalog = undefined; throw error; });
const publicCard = (c: CatalogCard) => ({ id: c.id, name: c.name, cardNumber: c.cardNumber, variation: c.variation,
  imageUrl: c.imageUrl, archivedAt: c.archived || !c.setActive ? 'archived' : null, setName: c.setName, year: c.year });

const cardId = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
// Validates label fields shared by create and update; throws a 400 message on bad input.
function labels(kind: Item['kind'], body: any): Partial<Item> {
  const parse = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v;
  if (kind === 'single') {
    const id = cardId(body.cardId);
    if (!id) throw new Error('A card ID is required for a single-card photo');
    const tags = (parse(body.tags) ?? []) as unknown[];
    if (!Array.isArray(tags) || tags.some(t => !TAGS.includes(t as any))) throw new Error('Unknown condition tag');
    return { cardId: id, tags: tags as string[], note: String(body.note ?? '').slice(0, 300) };
  }
  const cells = parse(body.cells) as unknown[];
  if (!Array.isArray(cells) || cells.length !== 9) throw new Error('A binder page needs 9 cell labels');
  const parsedCells = cells.map(c => (c === null || c === '' ? null : cardId(c)));
  if (cells.some((c, i) => c !== null && c !== '' && parsedCells[i] === null)) throw new Error('Cell labels must be card IDs or empty');
  const fields: Partial<Item> = { cells: parsedCells, note: String(body.note ?? '').slice(0, 300) };
  // Page corners are marked after upload, on the server's EXIF-rotated preview.
  const corners = parse(body.pageCorners ?? null) as CornerPoint[] | null;
  if (corners === null) return fields;
  const valid = Array.isArray(corners) && corners.length === 4 && corners.every(p =>
    Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && v >= 0 && v <= 1));
  if (!valid) throw new Error('Mark the 4 page corners');
  const ordered = orderCardCorners(corners);
  if (!isClockwiseConvex(ordered)) throw new Error('Page corners do not form a convex outline');
  return { ...fields, pageCorners: ordered };
}

export function registerPhaseC0PhotoRoutes(app: Express, authenticateUser: RequestHandler, options: { root?: string } = {}) {
  if (process.env.NODE_ENV !== 'development') return;
  if (options.root) { root = path.resolve(options.root); catalog = undefined; } // tests only
  const guard = [authenticateUser, requireDevelopmentAdmin];

  app.get(base, ...guard, async (_req, res) => {
    try { res.json({ tags: TAGS, items: await readItems() }); }
    catch { res.status(500).json({ message: 'Phase C0 labels unavailable' }); }
  });

  // Label check against the frozen production catalog snapshot (local file).
  app.get(`${base}/card/:id`, ...guard, async (req, res) => {
    const id = cardId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid card ID' });
    try {
      const card = (await loadCatalog()).byId.get(id);
      if (!card) return res.status(404).json({ message: `Card ${id} is not in the production catalog snapshot` });
      res.json(publicCard(card));
    } catch { res.status(500).json({ message: 'Production catalog snapshot unavailable' }); }
  });

  // Search the frozen production snapshot: every word must appear in the name, set or main-set
  // name, or equal the card number (ignoring a leading "#" and zeros). Active cards first.
  app.get(`${base}/search`, ...guard, async (req, res) => {
    const words = String(req.query.q ?? '').toLowerCase().split(/\s+/).map(w => w.replace(/^#/, '')).filter(Boolean).slice(0, 6);
    if (!words.length || words.join('').length < 2) return res.json([]);
    try {
      const { rows } = await loadCatalog();
      const hits = rows.filter(c => words.every(w => c.text.includes(w) || c.number === w.replace(/^0+(?=\d)/, '')));
      const inactive = (c: CatalogCard) => Number(c.archived || !c.setActive);
      hits.sort((a, b) => inactive(a) - inactive(b) || (a.year ?? 9999) - (b.year ?? 9999)
        || a.setName.localeCompare(b.setName) || String(a.cardNumber ?? '').localeCompare(String(b.cardNumber ?? ''), undefined, { numeric: true }) || a.id - b.id);
      res.json(hits.slice(0, 30).map(publicCard));
    } catch { res.status(500).json({ message: 'Production catalog snapshot unavailable' }); }
  });

  app.post(base, ...guard, upload.single('photo'), async (req: any, res) => {
    try {
      const kind = req.body?.kind === 'binder' ? 'binder' : req.body?.kind === 'single' ? 'single' : null;
      if (!kind) return res.status(400).json({ message: 'Choose single card or binder page' });
      if (!req.file) return res.status(400).json({ message: 'Photo is required' });
      let fields: Partial<Item>;
      try { fields = labels(kind, req.body); } catch (e) { return res.status(400).json({ message: (e as Error).message }); }
      const meta = await sharp(req.file.buffer).metadata().catch(() => null);
      if (!meta?.width || !['jpeg', 'png', 'webp'].includes(meta.format ?? ''))
        return res.status(400).json({ message: 'Use a JPEG, PNG or WebP photo (HEIC is not supported; set the camera to JPEG)' });
      const id = randomUUID();
      // Original bytes, untouched (EXIF kept), so experiments see what the phone produced.
      const file = path.join('photos', `${id}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`);
      await fs.mkdir(path.join(root, 'photos'), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(root, file), req.file.buffer, { mode: 0o600 });
      const now = new Date().toISOString();
      const items = await mutate(list => [...list, { id, kind, file, createdAt: now, updatedAt: now, ...fields }]);
      res.json(items.find(item => item.id === id));
    } catch { res.status(500).json({ message: 'Could not save photo' }); }
  });

  app.put(`${base}/:id`, ...guard, async (req, res) => {
    try {
      let saved: Item | undefined;
      await mutate(list => list.map(item => {
        if (item.id !== req.params.id) return item;
        const merged = item.kind === 'binder'
          ? { cells: item.cells, pageCorners: item.pageCorners, note: item.note, ...req.body }
          : { cardId: item.cardId, tags: item.tags, note: item.note, ...req.body };
        saved = { ...item, ...labels(item.kind, merged), updatedAt: new Date().toISOString() };
        return saved;
      }));
      if (!saved) return res.status(404).json({ message: 'Unknown photo' });
      res.json(saved);
    } catch (e) { res.status(400).json({ message: (e as Error).message || 'Could not update labels' }); }
  });

  // Owner-initiated removal of a mistaken upload, inside .local/phase-c0 only.
  app.delete(`${base}/:id`, ...guard, async (req, res) => {
    try {
      let removed: Item | undefined;
      await mutate(list => list.filter(item => item.id === req.params.id ? !(removed = item) : true));
      if (!removed) return res.status(404).json({ message: 'Unknown photo' });
      await fs.rm(path.join(root, removed.file), { force: true });
      res.json({ removed: removed.id });
    } catch { res.status(500).json({ message: 'Could not remove photo' }); }
  });

  app.get(`${base}/image/:id`, ...guard, async (req, res) => {
    try {
      const item = (await readItems()).find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ message: 'Unknown photo' });
      const file = path.resolve(root, item.file);
      if (!file.startsWith(root + path.sep)) return res.status(404).json({ message: 'Unknown photo' });
      // Preview only: EXIF orientation baked in so clicked page corners match the harness.
      const bytes = await sharp(await fs.readFile(file)).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
      res.set('Cache-Control', 'private, no-store');
      res.type('image/jpeg').send(bytes);
    } catch { res.status(500).json({ message: 'Image unavailable' }); }
  });
}

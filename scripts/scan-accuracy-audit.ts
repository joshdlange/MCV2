/**
 * Standalone scan benchmark. Importing this module does not connect to DB or AI.
 * Run: npx tsx scripts/scan-accuracy-audit.ts report --input saved.json --out report.json
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ScanResult } from '../server/services/scanService';

const identity = z.object({
  cardId: z.number().int().positive(),
  name: z.string().trim().min(1),
  year: z.number().int().min(1900).max(2100),
  mainSetId: z.number().int().positive(),
  mainSetName: z.string().trim().min(1),
  subsetSetId: z.number().int().positive(),
  subsetName: z.string().trim().min(1),
  cardNumber: z.string().trim().min(1),
  variation: z.string().nullable(),
}).strict();
export type CardIdentity = z.infer<typeof identity>;

const entry = z.object({
  id: z.string().trim().min(1),
  front: z.string().trim().min(1),
  back: z.string().trim().min(1).optional(),
  labelReviewed: z.literal(true),
  labelEvidence: z.string().trim().min(1),
  expected: identity,
  tags: z.array(z.string().trim().min(1)).default([]),
}).strict();
export const manifestSchema = z.object({
  reviewedBy: z.string().trim().min(1),
  reviewedAt: z.string().datetime(),
  scans: z.array(entry),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const [index, scan] of value.scans.entries()) {
    if (ids.has(scan.id)) ctx.addIssue({ code: 'custom', path: ['scans', index, 'id'], message: 'Duplicate scan id' });
    ids.add(scan.id);
  }
});
export type Manifest = z.infer<typeof manifestSchema>;

const savedEntry = z.object({
  id: z.string(),
  result: z.unknown().nullable(),
  predicted: z.array(identity.nullable()),
  latencyTotalMs: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
}).strict();
export const savedSchema = z.object({
  format: z.literal('scan-accuracy-audit-v1'),
  manifest: manifestSchema,
  runs: z.array(savedEntry),
}).strict();
export type Saved = z.infer<typeof savedSchema>;

function normalizedNumber(value: string) {
  let s = value.trim().toUpperCase().replace(/^NO\.?\s*|^#\s*/, '').replace(/\s*-\s*/g, '-').replace(/^([A-Z]{1,4})\s+(\d+)$/, '$1-$2');
  if (/^\d+$/.test(s)) s = String(parseInt(s, 10));
  return s;
}

export function audit(saved: Saved) {
  const input = savedSchema.parse(saved);
  const byId = new Map(input.runs.map(run => [run.id, run]));
  if (byId.size !== input.runs.length || input.runs.length !== input.manifest.scans.length
    || input.manifest.scans.some(scan => !byId.has(scan.id))) throw new Error('Saved runs must correspond exactly once to every manifest scan');
  const scans = input.manifest.scans.map(scan => {
    const run = byId.get(scan.id)!;
    const result = run.result as ScanResult | null;
    if (run.error && (result !== null || run.predicted.length)) throw new Error(`${scan.id}: failed run must not contain results`);
    if (!run.error && (!result || !Array.isArray(result.matches) || !result.parsed ||
      !['high', 'medium', 'low', 'none'].includes(result.confidenceLevel) ||
      !['verified', 'uncertain', 'abstained', 'unavailable'].includes(result.visualVerification)))
      throw new Error(`${scan.id}: missing or invalid scan result`);
    if (result && (run.predicted.length !== result.matches.length ||
      result.matches.some((m, i) => !m || m.cardId !== run.predicted[i]?.cardId && run.predicted[i] !== null)))
      throw new Error(`${scan.id}: candidate identity snapshots do not align with scan matches`);
    const top = result?.matches[0] ?? null;
    const topIdentity = run.predicted[0] ?? null;
    const errors = top ? {
      year: topIdentity ? topIdentity.year !== scan.expected.year : null,
      mainSet: topIdentity ? topIdentity.mainSetId !== scan.expected.mainSetId : null,
      subset: topIdentity ? (topIdentity.subsetSetId !== scan.expected.subsetSetId ||
        topIdentity.variation !== scan.expected.variation) : null,
      number: topIdentity ? normalizedNumber(topIdentity.cardNumber) !== normalizedNumber(scan.expected.cardNumber) : null,
    } : { year: null, mainSet: null, subset: null, number: null };
    return {
      id: scan.id, tags: scan.tags, expected: scan.expected,
      top: top ? { ...top, identity: topIdentity } : null,
      top3: (result?.matches ?? []).slice(0, 3).map((match, i) => ({ ...match, identity: run.predicted[i] })),
      extracted: result?.parsed ?? null, ocrText: result?.ocrText ?? null,
      visualStatus: result?.visualVerification ?? null,
      warnings: result?.warnings ?? [], reasons: top?.matchReasons ?? [],
      conflicts: top?.matchReasons.filter(reason => /conflict|differs/i.test(reason)) ?? [],
      top1Correct: top?.cardId === scan.expected.cardId,
      top3Correct: !!result?.matches.slice(0, 3).some(match => match.cardId === scan.expected.cardId),
      falseHigh: top?.confidenceLevel === 'high' && top.cardId !== scan.expected.cardId,
      errors, confidenceLevel: result?.confidenceLevel ?? null,
      latencyTotalMs: run.latencyTotalMs, stageLatencyMs: null,
      error: run.error,
    };
  });
  const n = scans.length;
  const count = (predicate: (s: typeof scans[number]) => boolean) => scans.filter(predicate).length;
  const field = (key: keyof typeof scans[number]['errors']) => ({
    wrong: count(s => s.errors[key] === true),
    known: count(s => s.errors[key] !== null),
    unknown: count(s => s.errors[key] === null),
  });
  const latencies = scans.map(s => s.latencyTotalMs).filter((n): n is number => n !== null);
  const visualStatuses = ['verified', 'uncertain', 'abstained', 'unavailable'] as const;
  return {
    format: 'scan-accuracy-report-v1', reviewedBy: input.manifest.reviewedBy, reviewedAt: input.manifest.reviewedAt,
    metrics: {
      scans: n, failures: count(s => !!s.error),
      top1: { correct: count(s => s.top1Correct), rate: n ? count(s => s.top1Correct) / n : null },
      top3: { correct: count(s => s.top3Correct), rate: n ? count(s => s.top3Correct) / n : null },
      falseHigh: { count: count(s => s.falseHigh), highPredictions: count(s => s.top?.confidenceLevel === 'high'),
        rateAmongHigh: count(s => s.top?.confidenceLevel === 'high') ? count(s => s.falseHigh) / count(s => s.top?.confidenceLevel === 'high') : null },
      wrongYear: field('year'), wrongMainSet: field('mainSet'), wrongSubset: field('subset'), wrongNumber: field('number'),
      uncertainty: { noMatch: count(s => !s.top && !s.error), levels: Object.fromEntries(['high', 'medium', 'low', 'none'].map(level => [level, count(s => s.confidenceLevel === level)])),
        visual: Object.fromEntries(visualStatuses.map(status => [status, count(s => s.visualStatus === status)])) },
      latency: { totalMs: { measured: latencies.length, mean: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null },
        stageMs: null, note: 'Stage timers unavailable in scanCard; no stage estimates.' },
    },
    scans,
  };
}

async function loadJson(file: string): Promise<unknown> { return JSON.parse(await readFile(file, 'utf8')); }
async function image(file: string, root: string) {
  if (path.isAbsolute(file) || file.includes('\0')) throw new Error(`Photo path must be relative: ${file}`);
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep)) throw new Error(`Photo path escapes manifest directory: ${file}`);
  const ext = path.extname(file).toLowerCase();
  const mimeType = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as Record<string, string>)[ext];
  if (!mimeType) throw new Error(`Unsupported photo extension: ${file}`);
  const buffer = await readFile(full);
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error(`Photo must be 1 byte–10MB: ${file}`);
  return { buffer, mimeType };
}

async function cli(args: string[]) {
  const [mode, ...rest] = args;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--') || flags.has(rest[i])) throw new Error(`Invalid/duplicate option: ${rest[i]}`);
    const flag = rest[i];
    flags.set(flag, flag === '--allow-live-ai' ? true : rest[++i] ?? '');
  }
  const permitted = mode === 'run' ? ['--manifest', '--out', '--allow-live-ai'] : mode === 'report' ? ['--input', '--out'] : [];
  if (!permitted.length || [...flags.keys()].some(k => !permitted.includes(k)) ||
    !flags.get('--out') || (mode === 'run' ? !flags.get('--manifest') || flags.get('--allow-live-ai') !== true : !flags.get('--input')))
    throw new Error('Usage: report --input saved.json --out report.json | run --manifest reviewed.json --out saved.json --allow-live-ai');
  const out = String(flags.get('--out'));
  if (mode === 'report') {
    const saved = savedSchema.parse(await loadJson(String(flags.get('--input'))));
    await writeFile(out, JSON.stringify(audit(saved), null, 2) + '\n', { flag: 'wx' });
    return;
  }
  const manifestFile = path.resolve(String(flags.get('--manifest')));
  const manifest = manifestSchema.parse(await loadJson(manifestFile));
  if (!manifest.scans.length) throw new Error('Live run requires at least one reviewed photo; empty manifests are report-only');
  if (await stat(out).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) throw new Error(`Output already exists: ${out}`);
  if (!process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) throw new Error('Live run requires OPENAI_API_KEY and DATABASE_URL');
  // Force all connections opened by scanCard/matcher into server-enforced read-only mode.
  const dbUrl = new URL(process.env.DATABASE_URL);
  dbUrl.searchParams.set('options', '-c default_transaction_read_only=on');
  process.env.DATABASE_URL = dbUrl.toString();
  process.env.PGOPTIONS = '-c default_transaction_read_only=on';
  const { db, pool } = await import('../server/db');
  const { cards, cardSets, mainSets } = await import('../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { scanCard } = await import('../server/services/scanService');
  async function lookup(id: number): Promise<CardIdentity | null> {
    const [row] = await db.select({
      cardId: cards.id, name: cards.name, year: cardSets.year,
      mainSetId: mainSets.id, mainSetName: mainSets.name,
      subsetSetId: cardSets.id, subsetName: cardSets.name,
      cardNumber: cards.cardNumber, variation: cards.variation,
    }).from(cards).innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id)).where(eq(cards.id, id));
    return row?.mainSetId && row.mainSetName ? identity.parse(row) : null;
  }
  try {
    const root = path.dirname(manifestFile);
    // Validate every label against the current catalog and every local photo before making any AI calls.
    for (const scan of manifest.scans) {
      const actual = await lookup(scan.expected.cardId);
      if (!actual || (Object.keys(scan.expected) as (keyof CardIdentity)[])
        .some(key => actual[key] !== scan.expected[key]))
        throw new Error(`${scan.id}: reviewed expected identity does not match current catalog (or main set join missing)`);
      await image(scan.front, root);
      if (scan.back) await image(scan.back, root);
    }
    const runs: Saved['runs'] = [];
    for (const scan of manifest.scans) {
      let started: number | null = null;
      try {
        const front = await image(scan.front, root);
        const back = scan.back ? await image(scan.back, root) : undefined;
        started = performance.now();
        const result = await scanCard(front.buffer, front.mimeType, back);
        const latencyTotalMs = performance.now() - started;
        const predicted = await Promise.all(result.matches.map(m => lookup(m.cardId)));
        runs.push({ id: scan.id, result, predicted, latencyTotalMs, error: null });
      } catch (err) {
        runs.push({ id: scan.id, result: null, predicted: [],
          latencyTotalMs: started === null ? null : performance.now() - started, error: String(err) });
      }
    }
    await writeFile(out, JSON.stringify({ format: 'scan-accuracy-audit-v1', manifest, runs }, null, 2) + '\n', { flag: 'wx' });
  } finally { await pool.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(err => { console.error(err); process.exitCode = 1; });
}
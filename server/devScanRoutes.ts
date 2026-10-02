import type { Express, RequestHandler } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { and, count, eq, sql } from 'drizzle-orm';
import { userScanLogs } from '../shared/schema';
import {
  getDevScanVisualService, isDevScanVisualEnabled, type DevScanVisualResult,
} from './services/devScanVisual';
import type { ScanResult } from './services/scanService';
import type { db } from './db';
import {
  assertDevScanTelemetryDatabase, devScanTelemetry, DevScanTelemetryError,
  isDevScanEventId, validateDevScanEventPatch, type DevScanTelemetry,
} from './services/devScanTelemetry';

export const DEV_SCAN_MAX_BYTES = 10 * 1024 * 1024;
export const DEV_SCAN_FREE_MONTHLY_LIMIT = 25;
const allowedMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
export interface DevScanUser { id: number; plan: string }

/** The lock and reservation commit together, before inference. Failed inference
 * still consumes a scan, matching the existing scan policy. No photo is stored.
 */
export async function reserveDevScanQuota(
  user: DevScanUser,
  database?: Pick<typeof db, 'transaction'>,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  assertDevScanTelemetryDatabase(env);
  let connection = database;
  if (!connection) {
    const { db: realDb, pool } = await import('./db');
    assertDevScanTelemetryDatabase({ ...env, DATABASE_URL: pool.options.connectionString });
    connection = realDb;
  }
  const startOfMonth = new Date(now);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  return connection.transaction(async tx => {
    // Transaction-scoped, per-user lock across all server workers.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1935892846, ${user.id})`);
    if (user.plan !== 'SUPER_HERO') {
      const [row] = await tx.select({ used: count() }).from(userScanLogs)
        .where(and(eq(userScanLogs.userId, user.id), sql`${userScanLogs.createdAt} >= ${startOfMonth}`));
      if (Number(row?.used ?? 0) >= DEV_SCAN_FREE_MONTHLY_LIMIT) return false;
    }
    await tx.insert(userScanLogs).values({ userId: user.id });
    return true;
  });
}

/** The response contains only an opaque telemetry event ID, never the photo. */
export function devScanResponse(result: DevScanVisualResult) {
  const parsed: ScanResult['parsed'] = {
    characterName: null, setName: null, subsetName: null, cardNumber: null,
    normalizedCardNumber: null, year: null, brand: null, variant: null,
    setCandidates: [], keywords: [],
  };
  return {
    mode: 'visual-v1' as const, imageUrl: null, scanUploadId: null, ocrText: '', parsed,
    matches: result.matches, families: result.families, topScore: result.topScore,
    margin: result.margin, timings: result.timings,
    confidenceLevel: result.matches.length ? 'low' as const : 'none' as const,
  };
}

export async function validateDevScanImage(file: Express.Multer.File): Promise<void> {
  if (!file.size || file.size > DEV_SCAN_MAX_BYTES) throw new Error('Invalid image size');
  if (!allowedMimeTypes.has(file.mimetype)) throw new Error('Invalid image type');
  const metadata = await sharp(file.buffer, { limitInputPixels: 24_000_000 }).metadata();
  const formats: Record<string, string> = {
    'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
  };
  if (metadata.format !== formats[file.mimetype] || !metadata.width || !metadata.height
      || metadata.width * metadata.height > 24_000_000 || (metadata.pages ?? 1) > 1) {
    throw new Error('Invalid image content');
  }
}

export interface DevScanRouteDependencies {
  env?: NodeJS.ProcessEnv;
  scan?: (buffer: Buffer) => Promise<DevScanVisualResult>;
  reserveQuota?: (user: DevScanUser) => Promise<boolean>;
  telemetry?: DevScanTelemetry;
  logError?: () => void;
}

/** Register before the legacy POST. Flag-off skips the entire route, including
 * auth and multipart handling, so the original path receives the untouched body.
 */
export function registerDevScanRoutes(
  app: Express,
  authenticateUser: RequestHandler,
  dependencies: DevScanRouteDependencies = {},
): void {
  const enabled = () => isDevScanVisualEnabled(dependencies.env ?? process.env);
  const scan = dependencies.scan ?? (buffer => getDevScanVisualService().scan(buffer));
  const reserveQuota = dependencies.reserveQuota
    ?? (user => reserveDevScanQuota(user, undefined, new Date(), dependencies.env ?? process.env));
  const telemetry = dependencies.telemetry ?? devScanTelemetry;
  const logError = dependencies.logError ?? (() => console.error('[DevScan] Visual scan failed'));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DEV_SCAN_MAX_BYTES, files: 1, fields: 0, parts: 2 },
    fileFilter: (_req, file, callback) => {
      if (!allowedMimeTypes.has(file.mimetype)) return callback(new Error('Invalid image type'));
      callback(null, true);
    },
  }).single('image');

  app.get('/api/cards/scan/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ visualV1: enabled() });
  });
  app.patch('/api/cards/scan/events/:id',
    (_req, res, next) => {
      if (!enabled()) { res.status(404).json({ message: 'Not found' }); return; }
      next();
    },
    authenticateUser,
    async (req, res) => {
      const user = (req as typeof req & { user?: DevScanUser }).user;
      if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
        res.status(401).json({ message: 'Authentication required' }); return;
      }
      if (!isDevScanEventId(req.params.id)) {
        res.status(400).json({ message: 'Invalid scan event ID' }); return;
      }
      try {
        const patch = validateDevScanEventPatch(req.body);
        await telemetry.patch(req.params.id, user.id, patch);
        res.json({ scanEventId: req.params.id, updated: true });
      } catch (error) {
        if (error instanceof DevScanTelemetryError) {
          res.status(error.statusCode).json({ message: error.message }); return;
        }
        logError();
        res.status(500).json({ message: 'Scan telemetry update failed. Please try again.' });
      }
    },
  );
  app.post('/api/cards/scan',
    (_req, _res, next) => enabled() ? next() : next('route'),
    authenticateUser,
    (req, res, next) => {
      upload(req, res, error => {
        if (error) {
          const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
          res.status(400).json({
            message: tooLarge ? 'Image too large (max 10MB per photo)'
              : 'Send one front image in the image field. Use JPEG, PNG, or WebP.',
          });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      // Normal authentication above supplies the canonical user; never trust
      // request fields or use a DEV identity bypass.
      const user = (req as typeof req & { user?: DevScanUser }).user;
      if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ message: 'Image file is required' });
        return;
      }
      try {
        await validateDevScanImage(file);
      } catch {
        res.status(400).json({ message: 'Invalid image. Use a single JPEG, PNG, or WebP photo (max 10MB).' });
        return;
      }
      const serverStarted = performance.now();
      let scanEventId: string | undefined;
      let phase: 'quota' | 'telemetry' | 'inference' = 'quota';
      try {
        if (!await reserveQuota(user)) {
          res.status(429).json({
            message: `You've used all ${DEV_SCAN_FREE_MONTHLY_LIMIT} free scans this month. Upgrade to Super Hero for unlimited scans!`,
            limitReached: true, limit: DEV_SCAN_FREE_MONTHLY_LIMIT,
          });
          return;
        }
        phase = 'telemetry';
        scanEventId = await telemetry.begin(user.id);
        phase = 'inference';
        const result = await scan(file.buffer);
        phase = 'telemetry';
        await telemetry.finish(scanEventId, user.id, {
          status: 'success', topScore: result.topScore, margin: result.margin,
          serverMs: performance.now() - serverStarted,
        });
        res.json({ ...devScanResponse(result), scanEventId });
      } catch {
        let telemetryFailed = phase === 'telemetry';
        if (scanEventId) {
          try {
            await telemetry.finish(scanEventId, user.id, {
              status: 'error', topScore: null, margin: null,
              serverMs: performance.now() - serverStarted,
            });
          } catch { telemetryFailed = true; }
        }
        // Do not log images, filenames, request bodies, identities, or raw errors.
        logError();
        res.status(500).json({
          message: telemetryFailed ? 'Scan telemetry logging failed. Please try again.' : 'Scan failed. Please try again.',
          ...(scanEventId ? { scanEventId } : {}),
        });
      } finally {
        // Release our reference immediately; buffers never leave this process.
        file.buffer = Buffer.alloc(0);
      }
    },
  );
}
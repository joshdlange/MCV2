import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DevScanUndoCapability } from './devScanUxRoutes';

function secret() {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required for scan Undo');
  return process.env.SESSION_SECRET;
}
export function createScanUndoToken(entry: DevScanUndoCapability, key = secret()): string {
  const payload = Buffer.from(JSON.stringify(entry)).toString('base64url');
  const signature = createHmac('sha256', key).update(`scan-undo:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
export function readScanUndoToken(token: unknown, key = secret()): DevScanUndoCapability | undefined {
  if (typeof token !== 'string' || token.length > 32_768) return;
  const pieces = token.split('.');
  if (pieces.length !== 2) return;
  const [payload, signature] = pieces;
  const expected = createHmac('sha256', key).update(`scan-undo:${payload}`).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return;
  try {
    const entry = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(entry.userId) || !Number.isSafeInteger(entry.rowId)
      || typeof entry.snapshot !== 'string' || !Number.isFinite(entry.expires)
      || entry.expires < Date.now()) return;
    return entry;
  } catch { return; }
}
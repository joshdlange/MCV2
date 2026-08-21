/**
 * Drive Image Sync v1 — DRY-RUN ONLY.
 *
 * Scans the Google Drive folder hierarchy (read-only scope), maps folders to
 * existing MCV card records, and produces a detailed report. It never uploads
 * to Cloudinary, never modifies card records, and never downloads image bytes.
 *
 * Expected hierarchy:
 *   Root → Main Set Folder → Subset Folder → Card Number Folder → image files
 */
import crypto from 'crypto';
import { db, pool } from '../db';
import { mainSets, cardSets, cards, driveSyncJobs, driveSyncSetCheckpoints, driveSyncState } from '../../shared/schema';
import { inArray, eq, sql, desc, and, isNull } from 'drizzle-orm';

// ---------- Google Drive auth (service account, read-only) ----------

interface ServiceAccount { client_email: string; private_key: string; }

function loadServiceAccount(): ServiceAccount {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8');
  }
  if (!raw) throw new Error('Google service account JSON is not configured (GOOGLE_SERVICE_ACCOUNT_JSON)');
  let sa: any;
  try { sa = JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('Service account JSON is missing client_email/private_key');
  return sa;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`Google OAuth token request failed (${res.status}): ${body.error_description || body.error || 'unknown'}`);
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

// ---------- Drive listing ----------

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Resilient fetch policy: retry network-level failures (DNS/reset/socket) and
// request timeouts with exponential backoff + jitter, in addition to HTTP 429
// and 5xx. Error messages always retain the operation label and underlying
// cause so the durable job's latestError is actionable.
const DRIVE_MAX_ATTEMPTS = 6;
const DRIVE_BASE_DELAY_MS = 500;
const DRIVE_MAX_DELAY_MS = 30_000;
const DRIVE_REQUEST_TIMEOUT_MS = 30_000;

function backoffDelay(attempt: number): number {
  const exp = Math.min(DRIVE_MAX_DELAY_MS, DRIVE_BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2)); // full-ish jitter
}

/**
 * Perform an authenticated Drive GET with retries.
 * @param url    the request URL
 * @param op     a human label for the operation (kept in every thrown error)
 */
async function driveFetch(url: string, op = 'Drive API request'): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < DRIVE_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRIVE_REQUEST_TIMEOUT_MS);
    try {
      const token = await getAccessToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal as any,
      });
      // Retryable HTTP statuses
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${op} failed: HTTP ${res.status} (retryable)`);
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        continue;
      }
      let body: any;
      try {
        body = await res.json();
      } catch (parseErr: any) {
        throw new Error(`${op} failed: could not parse response (HTTP ${res.status})`, { cause: parseErr });
      }
      if (!res.ok) {
        // Non-retryable client error (4xx other than 429): fail immediately.
        throw new Error(`${op} failed: HTTP ${res.status}: ${body?.error?.message || 'unknown'}`);
      }
      return body;
    } catch (err: any) {
      // AbortError (timeout) and network-level fetch failures ("fetch failed",
      // ECONNRESET, ENOTFOUND, EAI_AGAIN, socket hang up) are retryable.
      const msg = String(err?.message || err);
      const isAbort = err?.name === 'AbortError';
      const isNetwork = isAbort
        || /fetch failed|network|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|terminated/i.test(msg)
        || (err?.cause && /ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|network/i.test(String(err.cause?.code || err.cause?.message || '')));
      // Already-classified non-retryable HTTP errors bubble straight up.
      if (!isNetwork && /HTTP \d/.test(msg) && !/retryable/.test(msg)) {
        throw err;
      }
      lastErr = new Error(
        isAbort ? `${op} timed out after ${DRIVE_REQUEST_TIMEOUT_MS}ms` : `${op} network error: ${msg}`,
        { cause: err },
      );
      if (attempt < DRIVE_MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${op} failed after ${DRIVE_MAX_ATTEMPTS} attempts: ${lastErr?.message || 'unknown'}`, { cause: lastErr });
}

async function listChildren(folderId: string): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=1000&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const body = await driveFetch(url, `List folder children (${folderId})`);
    items.push(...(body.files || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function getFolderMeta(folderId: string): Promise<DriveItem> {
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true`;
  return driveFetch(url, `Get folder metadata (${folderId})`);
}

// ---------- Durable job status/progress (DB-backed) ----------
// Progress survives autoscale instance changes and restarts. The report
// endpoints read from these rows, not only from process memory.

const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

export interface JobProgress {
  stage?: string;
  folderListings?: number;
  totalSetFolders?: number;
  processedSetFolders?: number;
  currentSet?: string | null;
  cardFoldersProcessed?: number;
  imagesUploaded?: number;
  cardsUpdated?: number;
  scanErrorsCount?: number;
  skippedSetsUnchanged?: number;
  latestError?: string | null;
}

/** Lightweight durable job handle used to persist progress as work happens. */
class DriveSyncJobTracker {
  batchId: string;
  private closed = false;
  constructor(batchId: string) { this.batchId = batchId; }

  static async create(opts: {
    batchId: string; jobType: 'dry_run' | 'import'; mode: 'incremental' | 'full_audit';
    stage: string; options?: any;
  }): Promise<DriveSyncJobTracker> {
    await db.insert(driveSyncJobs).values({
      batchId: opts.batchId,
      jobType: opts.jobType,
      mode: opts.mode,
      status: 'running',
      stage: opts.stage,
      options: opts.options ?? null,
    });
    return new DriveSyncJobTracker(opts.batchId);
  }

  async update(p: JobProgress): Promise<void> {
    if (this.closed) return;
    const set: Record<string, any> = { heartbeatAt: new Date() };
    if (p.stage !== undefined) set.stage = p.stage;
    if (p.folderListings !== undefined) set.folderListings = p.folderListings;
    if (p.totalSetFolders !== undefined) set.totalSetFolders = p.totalSetFolders;
    if (p.processedSetFolders !== undefined) set.processedSetFolders = p.processedSetFolders;
    if (p.currentSet !== undefined) set.currentSet = p.currentSet;
    if (p.cardFoldersProcessed !== undefined) set.cardFoldersProcessed = p.cardFoldersProcessed;
    if (p.imagesUploaded !== undefined) set.imagesUploaded = p.imagesUploaded;
    if (p.cardsUpdated !== undefined) set.cardsUpdated = p.cardsUpdated;
    if (p.scanErrorsCount !== undefined) set.scanErrorsCount = p.scanErrorsCount;
    if (p.skippedSetsUnchanged !== undefined) set.skippedSetsUnchanged = p.skippedSetsUnchanged;
    if (p.latestError !== undefined) set.latestError = p.latestError;
    // Progress persistence must never crash the job.
    await db.update(driveSyncJobs).set(set).where(eq(driveSyncJobs.batchId, this.batchId)).catch((e) => {
      console.error('[DriveSync] Failed to persist job progress:', e?.message || e);
    });
  }

  async heartbeat(): Promise<void> {
    if (this.closed) return;
    await db.update(driveSyncJobs).set({ heartbeatAt: new Date() })
      .where(eq(driveSyncJobs.batchId, this.batchId)).catch(() => {});
  }

  async finish(status: 'completed' | 'failed', extra: { stage?: string; latestError?: string | null; detail?: any } = {}): Promise<void> {
    this.closed = true;
    const set: Record<string, any> = { status, finishedAt: new Date(), heartbeatAt: new Date() };
    if (extra.stage !== undefined) set.stage = extra.stage;
    if (extra.latestError !== undefined) set.latestError = extra.latestError;
    if (extra.detail !== undefined) set.detail = extra.detail;
    await db.update(driveSyncJobs).set(set).where(eq(driveSyncJobs.batchId, this.batchId)).catch((e) => {
      console.error('[DriveSync] Failed to finalize job:', e?.message || e);
    });
  }
}

/**
 * Read the latest durable job status for a job type. Marks a "running" row with
 * a stale heartbeat as "interrupted" (recoverable) before returning it, so the
 * report endpoint reflects reality even after an instance restart/crash.
 */
export async function getLatestDriveSyncJob(jobType: 'dry_run' | 'import'): Promise<DriveSyncJob | null> {
  const [row] = await db.select().from(driveSyncJobs)
    .where(eq(driveSyncJobs.jobType, jobType))
    .orderBy(desc(driveSyncJobs.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === 'running' && Date.now() - new Date(row.heartbeatAt).getTime() > STALE_HEARTBEAT_MS) {
    await db.update(driveSyncJobs).set({
      status: 'interrupted',
      latestError: row.latestError || 'Instance restarted or crashed before completion (recoverable)',
      finishedAt: new Date(),
    }).where(eq(driveSyncJobs.id, row.id)).catch(() => {});
    return { ...row, status: 'interrupted', latestError: row.latestError || 'Instance restarted or crashed before completion (recoverable)' };
  }
  return row;
}

/** True if a non-stale running job of the given type exists in the DB. */
export async function isDriveSyncJobRunningInDb(jobType: 'dry_run' | 'import'): Promise<boolean> {
  const job = await getLatestDriveSyncJob(jobType);
  return job?.status === 'running';
}

// ---------- Set-level checkpoint cache (incremental sync) ----------

/**
 * Cheap structural signature for a top-level set folder's subtree. We hash the
 * ids + modifiedTimes of the folder's direct children (one listing). If Drive
 * reports no change to any direct child, the subtree is treated as unchanged.
 * This is a SAFE approximation: any addition/removal/rename/mtime bump of a
 * direct child changes the signature; a change buried deeper WITHOUT touching a
 * direct child's mtime would not — Drive normally bumps ancestor mtimes, but to
 * stay honest this is a checkpoint cache, not exact Changes-API matching (see
 * module note / tradeoff below).
 */
function signatureFor(children: DriveItem[]): string {
  const parts = children
    .map(c => `${c.id}:${c.modifiedTime || ''}`)
    .sort();
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

async function loadSetCheckpoints(): Promise<Map<string, DriveSyncSetCheckpoint>> {
  const rows = await db.select().from(driveSyncSetCheckpoints);
  return new Map(rows.map(r => [r.driveFolderId, r]));
}

async function upsertSetCheckpoint(v: {
  driveFolderId: string; folderName: string; contentSignature: string;
  lastModifiedTime: string | null; completed: boolean; batchId: string;
}): Promise<void> {
  await db.insert(driveSyncSetCheckpoints).values({
    driveFolderId: v.driveFolderId,
    folderName: v.folderName,
    contentSignature: v.contentSignature,
    lastModifiedTime: v.lastModifiedTime,
    completed: v.completed,
    lastScannedAt: new Date(),
    lastBatchId: v.batchId,
  }).onConflictDoUpdate({
    target: driveSyncSetCheckpoints.driveFolderId,
    set: {
      folderName: v.folderName,
      contentSignature: v.contentSignature,
      lastModifiedTime: v.lastModifiedTime,
      completed: v.completed,
      lastScannedAt: new Date(),
      lastBatchId: v.batchId,
    },
  }).catch((e) => console.error('[DriveSync] checkpoint upsert failed:', e?.message || e));
}

// Pure decision: may a top-level set's checkpoint be marked completed after an
// import run? Extracted for direct unit testing. A set is completed ONLY when
// its subtree scanned cleanly, it had no per-item failures, and either it was
// skipped-as-unchanged (already imported) or every eligible folder was
// processed this run (maxFolders did not cut it off).
export function decideSetCheckpointCompleted(input: {
  cleanlyScanned: boolean;
  hadFailure: boolean;
  skippedUnchanged: boolean;
  totalEligible: number;
  processed: number;
}): boolean {
  const fullyProcessed = input.processed >= input.totalEligible;
  return input.cleanlyScanned && !input.hadFailure
    && (input.skippedUnchanged || fullyProcessed);
}

// ---------- Drive Changes API cursor (durable, singleton) ----------
// A normal incremental sync prefers this cursor: after a baseline full audit we
// store a startPageToken; a later sync pulls only the changes since the token
// and maps each changed file up to its TOP-LEVEL set folder, then rescans only
// those affected set folder(s). This avoids a full crawl.
//
// TRADEOFF / HONESTY: fully-correct Changes-API matching (resolving every
// changed file to a root-descendant set folder in all shared-drive / shortcut
// edge cases) is a broad refactor. We ship the cursor + affected-set targeting,
// AND back it with the set-level checkpoint cache so that even when the cursor
// is missing/reset or a change can't be resolved to a set, an incremental sync
// still provably avoids rescanning completed unchanged sets. We never silently
// claim "incremental": the report exposes mode, skippedUnchangedSets and, when
// the cursor is used, the affected set ids.

async function loadSyncState(): Promise<DriveSyncState | null> {
  const [row] = await db.select().from(driveSyncState).where(eq(driveSyncState.id, 1)).limit(1);
  return row ?? null;
}

/** Fetch a fresh Drive Changes startPageToken (the baseline cursor). */
async function fetchStartPageToken(): Promise<string> {
  const body = await driveFetch(
    'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true',
    'Get changes startPageToken',
  );
  if (!body?.startPageToken) throw new Error('Drive changes startPageToken response missing startPageToken');
  return body.startPageToken;
}

async function saveBaselineCursor(token: string): Promise<void> {
  await db.insert(driveSyncState).values({ id: 1, changesPageToken: token, baselineCompletedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: driveSyncState.id,
      set: { changesPageToken: token, baselineCompletedAt: new Date(), updatedAt: new Date() },
    });
}

async function saveCursor(token: string): Promise<void> {
  await db.insert(driveSyncState).values({ id: 1, changesPageToken: token, updatedAt: new Date() })
    .onConflictDoUpdate({ target: driveSyncState.id, set: { changesPageToken: token, updatedAt: new Date() } });
}

/**
 * Pull changes since the stored cursor and return the set of TOP-LEVEL set
 * folder ids that were affected, along with the new cursor token. Returns null
 * if no durable cursor exists yet (caller must fall back to checkpoint cache /
 * baseline). Resolution walks each changed file's parent chain up to a direct
 * child of the root; unresolved changes are reported but do not throw.
 */
async function computeAffectedSetsFromChanges(rootId: string): Promise<
  { affected: Set<string>; unresolved: number; newToken: string } | null
> {
  const state = await loadSyncState();
  if (!state?.changesPageToken) return null;

  // Map: folderId -> parentId cache to resolve ancestry cheaply.
  const parentCache = new Map<string, string | null>();
  const rootChildIds = new Set<string>();
  try {
    const children = await listChildren(rootId);
    for (const c of children) if (c.mimeType === FOLDER_MIME) rootChildIds.add(c.id);
  } catch (e: any) {
    // If we cannot list the root, targeted incremental sync is unsafe. Throw so
    // the caller performs an explicit recovery full audit without advancing the
    // existing cursor.
    throw new Error(`Drive changes root listing failed: ${e?.message || e}`, { cause: e });
  }

  const resolveTopSet = async (fileId: string): Promise<string | null> => {
    let current: string | null = fileId;
    for (let depth = 0; depth < 12 && current; depth++) {
      if (rootChildIds.has(current)) return current;
      let parent = parentCache.get(current);
      if (parent === undefined) {
        try {
          const meta = await driveFetch(
            `https://www.googleapis.com/drive/v3/files/${current}?fields=id,parents&supportsAllDrives=true`,
            `Resolve parents (${current})`,
          );
          parent = Array.isArray(meta.parents) && meta.parents.length ? meta.parents[0] : null;
        } catch {
          parent = null;
        }
        parentCache.set(current, parent ?? null);
      }
      if (parent && rootChildIds.has(parent)) return parent;
      current = parent ?? null;
    }
    return null;
  };

  const affected = new Set<string>();
  let unresolved = 0;
  let pageToken: string = state.changesPageToken;
  let newToken: string | null = null;
  const MAX_CHANGE_PAGES = 500;
  let pages = 0;
  while (true) {
    if (pages >= MAX_CHANGE_PAGES) {
      // Never accept a partial traversal: bailing here without a full
      // newStartPageToken and silently keeping/advancing the cursor would drop
      // the un-traversed tail of changes forever. Fail loudly so the caller
      // falls back to the checkpoint cache and the cursor is left untouched.
      throw new Error(`Drive changes traversal exceeded ${MAX_CHANGE_PAGES} pages without a terminal newStartPageToken; refusing partial cursor advance`);
    }
    pages++;
    const url = `https://www.googleapis.com/drive/v3/changes?pageToken=${encodeURIComponent(pageToken)}`
      + `&fields=newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,parents,mimeType))`
      + `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&includeRemoved=true`;
    const body = await driveFetch(url, 'List Drive changes');
    for (const ch of (body.changes || [])) {
      const fileId = ch.file?.id || ch.fileId;
      if (!fileId) { unresolved++; continue; }
      const top = await resolveTopSet(fileId);
      if (top) affected.add(top); else unresolved++;
    }
    if (body.nextPageToken) { pageToken = body.nextPageToken; continue; }
    // Terminal page: a valid newStartPageToken is REQUIRED to advance safely.
    if (!body.newStartPageToken) {
      throw new Error('Drive changes terminal page missing newStartPageToken; refusing cursor advance');
    }
    newToken = body.newStartPageToken;
    break;
  }
  if (!newToken) throw new Error('Drive changes traversal produced no newStartPageToken');

  return { affected, unresolved, newToken };
}

// ---------- Readiness check (fast pre-flight, no scan) ----------

export interface DriveSyncReadiness {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export async function checkDriveSyncReadiness(): Promise<DriveSyncReadiness> {
  const checks: DriveSyncReadiness['checks'] = [];

  // 1. Service account JSON present + parseable
  try {
    const sa = loadServiceAccount();
    checks.push({ name: 'Google service account', ok: true, detail: `Configured (${sa.client_email})` });
  } catch (err: any) {
    checks.push({ name: 'Google service account', ok: false, detail: err?.message || 'Not configured' });
  }

  // 2. Root folder configured
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  checks.push(rootId
    ? { name: 'Root folder ID', ok: true, detail: 'GOOGLE_DRIVE_ROOT_FOLDER_ID is set' }
    : { name: 'Root folder ID', ok: false, detail: 'GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured' });

  // 3. Drive API auth + root folder access (only if 1 & 2 passed)
  if (checks.every(c => c.ok) && rootId) {
    try {
      const meta = await getFolderMeta(rootId);
      if (meta.mimeType !== FOLDER_MIME) {
        checks.push({ name: 'Drive API access', ok: false, detail: `Root ID resolves to "${meta.name}" but it is not a folder` });
      } else {
        const children = await listChildren(rootId);
        const folders = children.filter(c => c.mimeType === FOLDER_MIME).length;
        checks.push({
          name: 'Drive API access',
          ok: true,
          detail: `Root folder "${meta.name}" reachable — ${folders} set folder${folders === 1 ? '' : 's'} visible`,
        });
      }
    } catch (err: any) {
      checks.push({ name: 'Drive API access', ok: false, detail: err?.message || 'Drive API request failed' });
    }
  } else {
    checks.push({ name: 'Drive API access', ok: false, detail: 'Skipped — fix the checks above first' });
  }

  // 4. Cloudinary (needed for real import, not dry run)
  try {
    const { cloudinary } = await import('../cloudinary');
    const cfg = cloudinary.config();
    if (!cfg.cloud_name || !cfg.api_key) {
      checks.push({ name: 'Cloudinary (for import)', ok: false, detail: 'Cloudinary credentials are not configured' });
    } else {
      await (cloudinary as any).api.ping();
      checks.push({ name: 'Cloudinary (for import)', ok: true, detail: `Connected (cloud: ${cfg.cloud_name})` });
    }
  } catch (err: any) {
    checks.push({ name: 'Cloudinary (for import)', ok: false, detail: err?.error?.message || err?.message || 'Cloudinary ping failed' });
  }

  // 5. Import ledger table
  try {
    const res = await db.execute((await import('drizzle-orm')).sql`SELECT COUNT(*)::int AS n FROM drive_image_imports WHERE status = 'uploaded'`);
    const n = (res.rows[0] as any)?.n ?? 0;
    checks.push({ name: 'Import ledger (database)', ok: true, detail: `Ready — ${n} image${n === 1 ? '' : 's'} previously imported` });
  } catch (err: any) {
    checks.push({ name: 'Import ledger (database)', ok: false, detail: err?.message || 'Could not query drive_image_imports' });
  }

  return { ok: checks.every(c => c.ok), checks };
}

// ---------- Matching helpers ----------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

function normalizeCardNumber(s: string): string {
  // "Card 53", "#53", "053" style folder names → strict-comparable form
  const cleaned = s.trim().replace(/^card\s+/i, '').replace(/^#/, '').trim();
  const noLeadingZeros = cleaned.replace(/^0+(?=\d)/, '');
  return noLeadingZeros.toLowerCase();
}

type ImageSide = 'front' | 'back' | 'ambiguous';

function inferSide(fileName: string): ImageSide {
  const base = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  if (/\b(front|obverse)\b|front/i.test(base)) return 'front';
  if (/\b(back|reverse)\b|back/i.test(base)) return 'back';
  // trailing 1/2 (e.g. "IMG_1", "53-1", "53 (2)")
  const m = base.match(/(?:^|[^0-9])([12])(?:\)|\s*)$/);
  if (m) return m[1] === '1' ? 'front' : 'back';
  return 'ambiguous';
}

// ---------- Report types ----------

interface ImageFileReport {
  driveFileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime?: string;
  parentPath: string;
  inferredMainSet: string;
  inferredSubset: string;
  inferredCardNumber: string;
  inferredSide: ImageSide;
}

interface CardFolderReport {
  path: string;
  driveFolderId: string;
  // Drive id of the top-level set folder this card folder belongs to. Used by
  // the import to group eligible folders per set and decide, after uploads,
  // which set checkpoints may be marked completed.
  setFolderId: string;
  mainSet: string;
  subset: string;
  cardNumber: string;
  imageCount: number;
  nonImageCount: number;
  hasNestedFolders: boolean;
  frontBackStatus: 'ok' | 'ambiguous' | 'missing_one' | 'none' | 'too_many';
  match: {
    status: 'matched' | 'unmatched_main_set' | 'unmatched_subset' | 'unmatched_card_number' | 'duplicate_card_match';
    cardId?: number;
    cardName?: string;
    setId?: number;
    setName?: string;
    candidateCardIds?: number[];
    cardAlreadyHasFrontImage?: boolean;
    cardAlreadyHasBackImage?: boolean;
  };
}

interface UnexpectedStructure { path: string; driveFolderId: string; reason: string; children?: string[]; }

// Recorded, non-fatal scan errors (e.g. one descendant folder failed to list).
// The affected subtree is skipped as "unsafe/incomplete" so a partial listing
// can never be treated as an authoritative empty/complete folder.
interface ScanError { path: string; driveFolderId: string; op: string; error: string; skippedSubtree: boolean; }

// Read-only, per top-level set folder scan metadata. Carries everything the
// import needs to (later) write a checkpoint safely — WITHOUT the scan itself
// writing anything.
export interface SetScanMeta {
  driveFolderId: string;
  folderName: string;
  contentSignature: string;
  lastModifiedTime: string | null;
  // The set's subtree listed without any scan error (safe to consider complete).
  cleanlyScanned: boolean;
  // This set was skipped in incremental mode because its signature matched an
  // already-completed checkpoint (its images are already imported).
  skippedUnchanged: boolean;
}

export interface DriveDryRunReport {
  ranAt: string;
  durationMs: number;
  mode: 'incremental' | 'full_audit';
  batchId?: string;
  rootFolder: { id: string; name: string };
  truncated: boolean;
  incomplete: boolean; // true if any scan error forced an unsafe subtree to be skipped
  scanErrors: ScanError[];
  skippedUnchangedSets: Array<{ name: string; id: string }>;
  // Per top-level set folder metadata gathered during the (read-only) scan.
  // The scan NEVER writes checkpoints; the import uses this to persist a
  // completed checkpoint only after a set's uploads finish cleanly.
  setScanMeta: SetScanMeta[];
  summary: {
    totalFirstLevelFolders: number;
    totalFoldersScanned: number;
    totalCardFoldersFound: number;
    totalImageFilesFound: number;
    matchedCardFolders: number;
    unmatchedCardFolders: number;
    ambiguousImagePairs: number;
    foldersWithUnexpectedStructure: number;
    cardFoldersNotExactlyTwoImages: number;
    duplicateDriveFileIds: number;
    duplicateCardMatches: number;
  };
  firstLevelFolders: { name: string; id: string; classification: 'main_set' | 'container_or_unknown' }[];
  matchedSamples: CardFolderReport[];
  unmatchedSamples: CardFolderReport[];
  ambiguousFolders: CardFolderReport[];
  unexpectedStructures: UnexpectedStructure[];
  containerReports: { name: string; id: string; childFolders: string[]; childFiles: number }[];
  duplicateDriveFileIdList: { driveFileId: string; paths: string[] }[];
  duplicateCardMatchList: { cardId: number; cardName: string; paths: string[] }[];
  allCardFolders: CardFolderReport[];
  allImageFiles: ImageFileReport[];
}

// Safety cap on Drive folder listings per run so a runaway hierarchy can't hang the server.
const MAX_FOLDER_LISTINGS = 6000;

let lastReport: DriveDryRunReport | null = null;
let running = false;

export function getLastDriveDryRunReport(): DriveDryRunReport | null {
  return lastReport;
}

export function isDriveDryRunRunning(): boolean {
  return running;
}

export interface DriveScanOptions {
  // 'incremental' (default): skip top-level set folders whose structural
  //   signature matches a completed checkpoint (no rescan of unchanged sets).
  // 'full_audit': crawl every set folder regardless of checkpoints.
  mode?: 'incremental' | 'full_audit';
  // Persist progress/status to this durable job row while scanning.
  tracker?: DriveSyncJobTracker;
  // Force these top-level set folder ids to be (re)scanned even in incremental
  // mode (e.g. sets flagged as changed by the Changes API / affected sets).
  forceSetIds?: Set<string>;
}

// ---------- Main dry-run / scan ----------

export async function runDriveImageSyncDryRun(opts: DriveScanOptions = {}): Promise<DriveDryRunReport> {
  if (running) throw new Error('A Drive dry-run is already in progress');
  running = true;
  const mode: 'incremental' | 'full_audit' = opts.mode ?? 'full_audit';
  const tracker = opts.tracker ?? null;
  const forceSetIds = opts.forceSetIds ?? null;
  const startedAt = Date.now();
  console.log(`[DriveSync] Scan started (mode=${mode}; read-only; no DB writes, no Cloudinary)`);
  try {
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!rootId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured');

    // Set-level checkpoints power incremental skipping of unchanged sets.
    const checkpoints = mode === 'incremental' ? await loadSetCheckpoints() : new Map<string, DriveSyncSetCheckpoint>();

    // DB reference data (read-only)
    const allMainSets = await db.select({ id: mainSets.id, name: mainSets.name }).from(mainSets);
    const allCardSets = await db.select({ id: cardSets.id, name: cardSets.name, mainSetId: cardSets.mainSetId }).from(cardSets);
    const mainSetByName = new Map<string, { id: number; name: string }>();
    for (const ms of allMainSets) mainSetByName.set(normalize(ms.name), ms);
    const cardSetsByMainSet = new Map<number, { id: number; name: string }[]>();
    for (const cs of allCardSets) {
      if (cs.mainSetId == null) continue;
      const arr = cardSetsByMainSet.get(cs.mainSetId) || [];
      arr.push({ id: cs.id, name: cs.name });
      cardSetsByMainSet.set(cs.mainSetId, arr);
    }

    let folderListings = 0;
    let truncated = false;
    const scanErrors: ScanError[] = [];
    // Wrap a listing so that a single descendant folder failure NEVER aborts the
    // whole job. Instead we record a scan error and let the caller decide how to
    // handle the affected (unsafe/incomplete) subtree.
    const listCountedSafe = async (id: string, path: string, opLabel: string): Promise<{ items: DriveItem[]; ok: boolean }> => {
      if (folderListings >= MAX_FOLDER_LISTINGS) { truncated = true; return { items: [], ok: false }; }
      folderListings++;
      if (folderListings % 100 === 0) {
        console.log(`[DriveSync] Progress: ${folderListings} folder listings so far...`);
        await tracker?.update({ folderListings });
      }
      try {
        return { items: await listChildren(id), ok: true };
      } catch (err: any) {
        const message = String(err?.message || err) + (err?.cause ? ` (cause: ${String(err.cause?.message || err.cause)})` : '');
        scanErrors.push({ path, driveFolderId: id, op: opLabel, error: message.slice(0, 500), skippedSubtree: true });
        console.error(`[DriveSync] Scan error listing "${path}" (${id}); skipping unsafe subtree: ${message}`);
        await tracker?.update({ scanErrorsCount: scanErrors.length, latestError: message.slice(0, 500) });
        return { items: [], ok: false };
      }
    };

    const rootMeta = await getFolderMeta(rootId);
    const rootListing = await listCountedSafe(rootId, rootMeta.name.trim(), 'list root');
    if (!rootListing.ok) {
      // Root listing itself failing is fatal — we cannot scan anything.
      throw new Error(`Failed to list root folder "${rootMeta.name}": ${scanErrors[scanErrors.length - 1]?.error || 'unknown'}`);
    }
    const firstLevel = rootListing.items.filter(i => i.mimeType === FOLDER_MIME);

    const report: DriveDryRunReport = {
      ranAt: new Date().toISOString(),
      durationMs: 0,
      mode,
      batchId: tracker?.batchId,
      rootFolder: { id: rootMeta.id, name: rootMeta.name.trim() },
      truncated: false,
      incomplete: false,
      scanErrors,
      skippedUnchangedSets: [],
      summary: {
        totalFirstLevelFolders: firstLevel.length,
        totalFoldersScanned: 0,
        totalCardFoldersFound: 0,
        totalImageFilesFound: 0,
        matchedCardFolders: 0,
        unmatchedCardFolders: 0,
        ambiguousImagePairs: 0,
        foldersWithUnexpectedStructure: 0,
        cardFoldersNotExactlyTwoImages: 0,
        duplicateDriveFileIds: 0,
        duplicateCardMatches: 0,
      },
      firstLevelFolders: [],
      matchedSamples: [],
      unmatchedSamples: [],
      ambiguousFolders: [],
      unexpectedStructures: [],
      containerReports: [],
      duplicateDriveFileIdList: [],
      duplicateCardMatchList: [],
      allCardFolders: [],
      allImageFiles: [],
      setScanMeta: [],
    };

    await tracker?.update({ stage: 'scanning', totalSetFolders: firstLevel.length, folderListings });

    // Track which sets we fully & cleanly scanned. This drives the read-only
    // setScanMeta ONLY; the scan itself NEVER writes checkpoints (see fix note).
    const setScanErrorsBefore = new Map<string, number>();
    const setSignature = new Map<string, string>();
    const setModified = new Map<string, string | null>();
    const setName = new Map<string, string>();

    const fileIdPaths = new Map<string, string[]>();
    interface PendingCardFolder {
      folder: DriveItem;
      path: string;
      setFolderId: string;
      mainSetName: string;
      subsetName: string;
      mainSetId: number | null;
      cardSetId: number | null;
      cardSetName: string | null;
      children: DriveItem[];
    }
    const pendingCardFolders: PendingCardFolder[] = [];

    let processedSetFolders = 0;
    for (const top of firstLevel) {
      const topName = top.name.trim();
      setName.set(top.id, topName);
      const matchedMainSet = mainSetByName.get(normalize(topName)) || null;
      const topListing = await listCountedSafe(top.id, topName, 'list set folder');
      if (!topListing.ok) {
        // Could not even list this top-level set folder: skip its subtree
        // entirely (already recorded as a scan error), do NOT touch checkpoint.
        report.incomplete = true;
        processedSetFolders++;
        await tracker?.update({ processedSetFolders, currentSet: topName, folderListings, scanErrorsCount: scanErrors.length });
        continue;
      }
      const topChildren = topListing.items;
      report.summary.totalFoldersScanned++;
      const topChildFolders = topChildren.filter(c => c.mimeType === FOLDER_MIME);
      const topChildFiles = topChildren.filter(c => c.mimeType !== FOLDER_MIME);

      // ---- Incremental skip: unchanged completed set ----
      // Compute a cheap structural signature from the set folder's direct
      // children. If it matches a checkpoint that completed cleanly, and this
      // set isn't force-listed, skip the whole subtree without re-crawling.
      const signature = signatureFor(topChildren);
      const latestMtime = topChildren.reduce<string | null>(
        (acc, c) => (c.modifiedTime && (!acc || c.modifiedTime > acc) ? c.modifiedTime : acc),
        top.modifiedTime || null,
      );
      setSignature.set(top.id, signature);
      setModified.set(top.id, latestMtime);
      setScanErrorsBefore.set(top.id, scanErrors.length);

      if (mode === 'incremental' && !(forceSetIds?.has(top.id))) {
        const cp = checkpoints.get(top.id);
        if (cp && cp.completed && cp.contentSignature === signature) {
          report.skippedUnchangedSets.push({ name: topName, id: top.id });
          // Record for the import so it can refresh (keep completed) this set's
          // checkpoint. Its images are already imported (checkpoint completed).
          report.setScanMeta.push({
            driveFolderId: top.id, folderName: topName,
            contentSignature: signature, lastModifiedTime: latestMtime,
            cleanlyScanned: true, skippedUnchanged: true,
          });
          processedSetFolders++;
          await tracker?.update({
            processedSetFolders, currentSet: topName, folderListings,
            skippedSetsUnchanged: report.skippedUnchangedSets.length,
          });
          console.log(`[DriveSync] Incremental: skipping unchanged set "${topName}"`);
          continue;
        }
      }

      // Heuristic: a main-set folder should contain subset folders whose children are card-number folders.
      // If the folder doesn't match a known main set AND its structure doesn't look like the expected
      // hierarchy, classify as container/unknown and report one level of its children without deep-scanning.
      let looksLikeHierarchy = false;
      if (topChildFolders.length > 0) {
        const probe = await listCountedSafe(topChildFolders[0].id, `${topName} / ${topChildFolders[0].name.trim()}`, 'probe subset');
        report.summary.totalFoldersScanned++;
        const probeFolders = probe.items.filter(c => c.mimeType === FOLDER_MIME);
        looksLikeHierarchy = probeFolders.length > 0;
      }

      // Wrapper/container detection: a first-level folder that doesn't match a
      // main set but whose CHILD folders look like set names (match main sets or
      // resemble the top-level set folders) is a container, even if it has depth.
      const childrenLookLikeSets = topChildFolders.some(f => mainSetByName.has(normalize(f.name.trim())));

      if (!matchedMainSet && (childrenLookLikeSets || !looksLikeHierarchy)) {
        report.firstLevelFolders.push({ name: topName, id: top.id, classification: 'container_or_unknown' });
        report.containerReports.push({
          name: topName,
          id: top.id,
          childFolders: topChildFolders.map(f => f.name),
          childFiles: topChildFiles.length,
        });
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path: topName,
          driveFolderId: top.id,
          reason: matchedMainSet
            ? 'Matches a main set but contains no subset folders'
            : 'Does not match any main set and does not follow the Main Set → Subset → Card structure',
          children: topChildFolders.map(f => f.name).slice(0, 50),
        });
        processedSetFolders++;
        await tracker?.update({ processedSetFolders, currentSet: topName, folderListings });
        continue;
      }

      report.firstLevelFolders.push({ name: topName, id: top.id, classification: 'main_set' });
      if (topChildFiles.length > 0) {
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path: topName,
          driveFolderId: top.id,
          reason: `Main set folder contains ${topChildFiles.length} loose file(s) at subset level`,
        });
      }

      for (const subsetFolder of topChildFolders) {
        const subsetName = subsetFolder.name.trim();
        const path = `${topName} / ${subsetName}`;
        const subsetListing = await listCountedSafe(subsetFolder.id, path, 'list subset folder');
        if (!subsetListing.ok) {
          // Skip this subset's card folders (unsafe/incomplete). Recorded as a
          // scan error; the set will not be marked completed.
          report.incomplete = true;
          continue;
        }
        const subsetChildren = subsetListing.items;
        report.summary.totalFoldersScanned++;
        const cardFolders = subsetChildren.filter(c => c.mimeType === FOLDER_MIME);
        const looseFiles = subsetChildren.filter(c => c.mimeType !== FOLDER_MIME);
        if (looseFiles.length > 0) {
          report.summary.foldersWithUnexpectedStructure++;
          report.unexpectedStructures.push({
            path,
            driveFolderId: subsetFolder.id,
            reason: `Subset folder contains ${looseFiles.length} loose file(s) at card-number level`,
          });
        }

        // Strict subset match (only within the matched main set)
        let cardSetMatch: { id: number; name: string } | null = null;
        if (matchedMainSet) {
          const candidates = cardSetsByMainSet.get(matchedMainSet.id) || [];
          const normSubset = normalize(subsetName);
          cardSetMatch = candidates.find(c => normalize(c.name) === normSubset)
            || candidates.find(c => normalize(c.name) === normalize(`${topName} ${subsetName}`))
            || null;
        }

        // List card folders with limited concurrency (Drive quota is generous;
        // sequential listing of thousands of folders would take an hour).
        const CONCURRENCY = 8;
        for (let i = 0; i < cardFolders.length; i += CONCURRENCY) {
          const batch = cardFolders.slice(i, i + CONCURRENCY);
          const results = await Promise.all(batch.map(async (cardFolder) => ({
            cardFolder,
            listing: await listCountedSafe(cardFolder.id, `${path} / ${cardFolder.name.trim()}`, 'list card folder'),
          })));
          for (const { cardFolder, listing } of results) {
            if (!listing.ok) {
              // Card folder listing failed → skip this card folder only.
              // Recorded as scan error; the set is not "complete".
              report.incomplete = true;
              continue;
            }
            report.summary.totalFoldersScanned++;
            pendingCardFolders.push({
              folder: cardFolder,
              path: `${path} / ${cardFolder.name.trim()}`,
              setFolderId: top.id,
              mainSetName: topName,
              subsetName,
              mainSetId: matchedMainSet?.id ?? null,
              cardSetId: cardSetMatch?.id ?? null,
              cardSetName: cardSetMatch?.name ?? null,
              children: listing.items,
            });
          }
        }
      }

      // Finished listing this top-level set. The scan is READ-ONLY: it does NOT
      // write a checkpoint here. Writing a completed checkpoint at scan time was
      // a resumability bug — uploads happen only after the whole scan, so a
      // crash between scan and upload would strand un-imported images behind a
      // "completed" checkpoint on the next run. Instead we record read-only
      // metadata; the IMPORT persists the checkpoint (completed only) after this
      // set's uploads finish cleanly.
      const cleanSet = scanErrors.length === (setScanErrorsBefore.get(top.id) ?? scanErrors.length);
      report.setScanMeta.push({
        driveFolderId: top.id,
        folderName: topName,
        contentSignature: setSignature.get(top.id) || signatureFor(topChildren),
        lastModifiedTime: setModified.get(top.id) ?? null,
        cleanlyScanned: cleanSet,
        skippedUnchanged: false,
      });
      processedSetFolders++;
      await tracker?.update({
        processedSetFolders, currentSet: topName, folderListings,
        cardFoldersProcessed: pendingCardFolders.length, scanErrorsCount: scanErrors.length,
      });
    }

    // Load card rows for all matched sets in one query (read-only)
    const matchedSetIds = Array.from(new Set(pendingCardFolders.map(p => p.cardSetId).filter((x): x is number => x != null)));
    const cardRows = matchedSetIds.length
      ? await db.select({
          id: cards.id, setId: cards.setId, cardNumber: cards.cardNumber, name: cards.name,
          frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl,
        }).from(cards).where(inArray(cards.setId, matchedSetIds))
      : [];
    const cardsBySetAndNumber = new Map<string, typeof cardRows>();
    for (const c of cardRows) {
      const key = `${c.setId}|${normalizeCardNumber(c.cardNumber)}`;
      const arr = cardsBySetAndNumber.get(key) || [];
      arr.push(c);
      cardsBySetAndNumber.set(key, arr);
    }

    const cardMatchPaths = new Map<number, { name: string; paths: string[] }>();

    for (const pending of pendingCardFolders) {
      const { folder, path, children } = pending;
      const cardNumberRaw = folder.name.trim();
      const nestedFolders = children.filter(c => c.mimeType === FOLDER_MIME);
      const files = children.filter(c => c.mimeType !== FOLDER_MIME);
      const imageFiles = files.filter(f => f.mimeType.startsWith('image/'));
      const nonImageFiles = files.filter(f => !f.mimeType.startsWith('image/'));

      report.summary.totalCardFoldersFound++;
      report.summary.totalImageFilesFound += imageFiles.length;

      if (nestedFolders.length > 0) {
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path, driveFolderId: folder.id,
          reason: `Card folder contains ${nestedFolders.length} nested folder(s) (unexpected depth)`,
          children: nestedFolders.map(f => f.name).slice(0, 20),
        });
      }
      if (nonImageFiles.length > 0) {
        report.summary.foldersWithUnexpectedStructure++;
        report.unexpectedStructures.push({
          path, driveFolderId: folder.id,
          reason: `Card folder contains ${nonImageFiles.length} non-image file(s): ${nonImageFiles.map(f => f.name).slice(0, 5).join(', ')}`,
        });
      }

      // Front/back inference
      const sides = imageFiles.map(f => inferSide(f.name));
      let frontBackStatus: CardFolderReport['frontBackStatus'];
      if (imageFiles.length === 0) frontBackStatus = 'none';
      else if (imageFiles.length === 1) frontBackStatus = 'missing_one';
      else if (imageFiles.length > 2) frontBackStatus = 'too_many';
      else {
        const hasFront = sides.includes('front');
        const hasBack = sides.includes('back');
        frontBackStatus = hasFront && hasBack ? 'ok' : 'ambiguous';
      }
      if (frontBackStatus === 'ambiguous') report.summary.ambiguousImagePairs++;
      if (imageFiles.length !== 2) report.summary.cardFoldersNotExactlyTwoImages++;

      // Strict card match
      let match: CardFolderReport['match'];
      if (pending.mainSetId == null) {
        match = { status: 'unmatched_main_set' };
      } else if (pending.cardSetId == null) {
        match = { status: 'unmatched_subset' };
      } else {
        const key = `${pending.cardSetId}|${normalizeCardNumber(cardNumberRaw)}`;
        const found = cardsBySetAndNumber.get(key) || [];
        if (found.length === 0) {
          match = { status: 'unmatched_card_number', setId: pending.cardSetId, setName: pending.cardSetName! };
        } else if (found.length > 1) {
          match = {
            status: 'duplicate_card_match',
            setId: pending.cardSetId, setName: pending.cardSetName!,
            candidateCardIds: found.map(c => c.id),
          };
          report.summary.duplicateCardMatches++;
        } else {
          const c = found[0];
          match = {
            status: 'matched',
            cardId: c.id, cardName: c.name, setId: pending.cardSetId, setName: pending.cardSetName!,
            cardAlreadyHasFrontImage: !!c.frontImageUrl, cardAlreadyHasBackImage: !!c.backImageUrl,
          };
          const entry = cardMatchPaths.get(c.id) || { name: c.name, paths: [] };
          entry.paths.push(path);
          cardMatchPaths.set(c.id, entry);
        }
      }

      const folderReport: CardFolderReport = {
        path, driveFolderId: folder.id, setFolderId: pending.setFolderId,
        mainSet: pending.mainSetName, subset: pending.subsetName, cardNumber: cardNumberRaw,
        imageCount: imageFiles.length, nonImageCount: nonImageFiles.length,
        hasNestedFolders: nestedFolders.length > 0,
        frontBackStatus, match,
      };
      report.allCardFolders.push(folderReport);
      if (match.status === 'matched') report.summary.matchedCardFolders++;
      else report.summary.unmatchedCardFolders++;

      for (const f of imageFiles) {
        report.allImageFiles.push({
          driveFileId: f.id, fileName: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
          parentPath: path,
          inferredMainSet: pending.mainSetName, inferredSubset: pending.subsetName,
          inferredCardNumber: cardNumberRaw, inferredSide: inferSide(f.name),
        });
        const paths = fileIdPaths.get(f.id) || [];
        paths.push(`${path} / ${f.name}`);
        fileIdPaths.set(f.id, paths);
      }
    }

    // Duplicates
    for (const [fileId, paths] of Array.from(fileIdPaths.entries())) {
      if (paths.length > 1) {
        report.summary.duplicateDriveFileIds++;
        report.duplicateDriveFileIdList.push({ driveFileId: fileId, paths });
      }
    }
    for (const [cardId, entry] of Array.from(cardMatchPaths.entries())) {
      if (entry.paths.length > 1) {
        report.summary.duplicateCardMatches++;
        report.duplicateCardMatchList.push({ cardId, cardName: entry.name, paths: entry.paths });
      }
    }

    // Samples
    report.matchedSamples = report.allCardFolders.filter(f => f.match.status === 'matched').slice(0, 10);
    report.unmatchedSamples = report.allCardFolders.filter(f => f.match.status !== 'matched').slice(0, 10);
    report.ambiguousFolders = report.allCardFolders.filter(f => f.frontBackStatus === 'ambiguous').slice(0, 25);

    report.truncated = truncated;
    // A truncated scan (hit MAX_FOLDER_LISTINGS) has NOT observed the whole
    // hierarchy, so it is incomplete for cursor-safety purposes: callers must
    // not establish/advance a Changes cursor off a partial crawl.
    if (truncated) report.incomplete = true;
    report.durationMs = Date.now() - startedAt;
    lastReport = report;
    await tracker?.update({
      stage: 'matched', folderListings, processedSetFolders,
      cardFoldersProcessed: report.summary.totalCardFoldersFound,
      scanErrorsCount: scanErrors.length,
      skippedSetsUnchanged: report.skippedUnchangedSets.length,
    });
    console.log(`[DriveSync] Scan (${mode}) complete in ${report.durationMs}ms: ${report.summary.totalCardFoldersFound} card folders, ${report.summary.matchedCardFolders} matched, ${report.summary.unmatchedCardFolders} unmatched, ${report.summary.totalImageFilesFound} images, ${scanErrors.length} scan error(s), ${report.skippedUnchangedSets.length} unchanged set(s) skipped (no data modified)`);
    return report;
  } finally {
    running = false;
  }
}

// ---------- Cleanup report (derived from a completed dry-run; read-only) ----------
// Builds admin-facing cleanup tables so folder/database mismatches can be fixed
// BEFORE any real import. Never modifies Drive, DB, or Cloudinary.

interface CleanupCandidate { name: string; score: number; }

export interface DriveCleanupReport {
  generatedAt: string;
  sourceRanAt: string;
  unmatched: Array<{
    mainSetFolder: string; subsetFolder: string; cardNumberFolder: string;
    imageCount: number; reason: string; candidates: string[];
  }>;
  ambiguousFrontBack: Array<{
    folderPath: string; image1: string; image2: string;
    sortOrder: string; proposedFront: string; proposedBack: string; proposalBasis: string;
  }>;
  wrongImageCount: Array<{
    folderPath: string; imageCount: number; nonImageCount: number; matchStatus: string;
  }>;
  structureOddities: Array<{ path: string; reason: string; children?: string[] }>;
  counts: { unmatched: number; ambiguousFrontBack: number; wrongImageCount: number; structureOddities: number };
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(t => t.length > 1));
}

function similarity(a: string, b: string): number {
  const ta = tokenSet(a); const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

function topCandidates(target: string, pool: string[], max = 3, minScore = 0.5): string[] {
  const scored: CleanupCandidate[] = pool
    .map(name => ({ name, score: similarity(target, name) }))
    .filter(c => c.score >= minScore)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, max).map(c => `${c.name} (${Math.round(c.score * 100)}% similar)`);
}

const REASON_LABELS: Record<string, string> = {
  unmatched_main_set: 'Main set folder does not match any main set in the database',
  unmatched_subset: 'Main set matched, but subset folder name does not match any of its sets',
  unmatched_card_number: 'Set matched, but card number not found in that set (check O vs 0 typos)',
};

export async function buildDriveCleanupReport(): Promise<DriveCleanupReport> {
  let source = lastReport;
  if (!source) {
    const fs = await import('fs');
    if (fs.existsSync('/tmp/drive_dryrun_report.json')) {
      source = JSON.parse(fs.readFileSync('/tmp/drive_dryrun_report.json', 'utf8'));
    }
  }
  if (!source) throw new Error('No dry-run report available. Run the dry-run first.');

  // Read-only reference data for candidate suggestions (suggestions only — never auto-mapped)
  const allMainSets = await db.select({ id: mainSets.id, name: mainSets.name }).from(mainSets);
  const allCardSets = await db.select({ id: cardSets.id, name: cardSets.name, mainSetId: cardSets.mainSetId }).from(cardSets);
  const mainSetNameById = new Map(allMainSets.map(m => [m.id, m.name]));
  const mainSetIdByNorm = new Map(allMainSets.map(m => [normalize(m.name), m.id]));

  const report: DriveCleanupReport = {
    generatedAt: new Date().toISOString(),
    sourceRanAt: source.ranAt,
    unmatched: [], ambiguousFrontBack: [], wrongImageCount: [],
    structureOddities: source.unexpectedStructures.map(u => ({ path: u.path, reason: u.reason, children: u.children })),
    counts: { unmatched: 0, ambiguousFrontBack: 0, wrongImageCount: 0, structureOddities: source.unexpectedStructures.length },
  };

  // Group image files by folder for the ambiguous table
  const filesByFolder = new Map<string, Array<{ fileName: string }>>();
  for (const f of source.allImageFiles) {
    const arr = filesByFolder.get(f.parentPath) || [];
    arr.push({ fileName: f.fileName });
    filesByFolder.set(f.parentPath, arr);
  }

  for (const folder of source.allCardFolders) {
    const status = folder.match.status;
    if (status !== 'matched') {
      let candidates: string[] = [];
      if (status === 'unmatched_main_set') {
        // Main set folder didn't match: suggest similar MAIN SET names, plus any
        // card sets anywhere in the DB whose name matches the subset folder.
        const mainCands = topCandidates(folder.mainSet, allMainSets.map(m => m.name))
          .map(c => `main set: ${c}`);
        const subsetCands = topCandidates(folder.subset, allCardSets.map(s => s.name))
          .map(c => `set (any main set): ${c}`);
        candidates = [...mainCands, ...subsetCands];
      } else if (status === 'unmatched_subset') {
        const mainId = mainSetIdByNorm.get(normalize(folder.mainSet));
        const pool = allCardSets.filter(s => s.mainSetId === mainId).map(s => s.name);
        candidates = topCandidates(folder.subset, pool);
        if (candidates.length === 0) candidates = topCandidates(folder.subset, allCardSets.map(s => s.name));
      }
      report.unmatched.push({
        mainSetFolder: folder.mainSet,
        subsetFolder: folder.subset,
        cardNumberFolder: folder.cardNumber,
        imageCount: folder.imageCount,
        reason: REASON_LABELS[status] || status,
        candidates,
      });
    }
    if (folder.frontBackStatus === 'ambiguous') {
      const files = (filesByFolder.get(folder.path) || []).map(f => f.fileName).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      // Prefer explicit filename markers: if exactly one file says front (or back),
      // propose based on that; only fall back to sort order when neither helps.
      let proposedFront = files[0] || '';
      let proposedBack = files[1] || '';
      let proposalBasis = 'sort order (no filename markers)';
      if (files.length === 2) {
        const sides = files.map(f => inferSide(f));
        if (sides[0] === 'front' && sides[1] !== 'front') {
          proposedFront = files[0]; proposedBack = files[1]; proposalBasis = `"${files[0]}" is marked front`;
        } else if (sides[1] === 'front' && sides[0] !== 'front') {
          proposedFront = files[1]; proposedBack = files[0]; proposalBasis = `"${files[1]}" is marked front`;
        } else if (sides[0] === 'back' && sides[1] !== 'back') {
          proposedBack = files[0]; proposedFront = files[1]; proposalBasis = `"${files[0]}" is marked back`;
        } else if (sides[1] === 'back' && sides[0] !== 'back') {
          proposedBack = files[1]; proposedFront = files[0]; proposalBasis = `"${files[1]}" is marked back`;
        }
      }
      report.ambiguousFrontBack.push({
        folderPath: folder.path,
        image1: files[0] || '',
        image2: files[1] || '',
        sortOrder: 'alphabetical (numeric-aware)',
        proposedFront,
        proposedBack,
        proposalBasis,
      });
    }
    if (folder.imageCount !== 2) {
      report.wrongImageCount.push({
        folderPath: folder.path,
        imageCount: folder.imageCount,
        nonImageCount: folder.nonImageCount,
        matchStatus: status === 'matched' ? 'matched' : 'unmatched',
      });
    }
  }

  report.counts.unmatched = report.unmatched.length;
  report.counts.ambiguousFrontBack = report.ambiguousFrontBack.length;
  report.counts.wrongImageCount = report.wrongImageCount.length;
  return report;
}

// ---------- Drive Image Sync v2 — REAL IMPORT (admin-only, explicit confirmation) ----------
// Uploads ONLY clean, high-confidence matched images to Cloudinary and updates
// the matched card records. Everything uncertain is skipped and reported.
// Never modifies Drive, never creates cards, never touches user collections.

import { driveImageImports } from '../../shared/schema';
import { cloudinary } from '../cloudinary';

const IMPORT_FOLDER = 'marvel-cards/drive-sync';
const IMPORT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMPORT_DOWNLOAD_TIMEOUT_MS = 30_000;
const IMPORT_UPLOAD_TIMEOUT_MS = 60_000;
const CLOUDINARY_MAX_ATTEMPTS = 3;
const IMPORT_DELAY_MS = 400; // pause between folders so the server stays responsive
const IMPORT_LOCK_KEY = 'drive-image-import';

export interface DriveImportReport {
  batchId: string;
  ranAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed';
  mode: 'incremental' | 'full_audit';
  // How incrementality was achieved this run (never silently "incremental").
  incrementalStrategy: 'changes_cursor' | 'checkpoint_cache' | 'baseline_full' | 'full_audit';
  affectedSetIds?: string[];
  unresolvedChanges?: number;
  skippedUnchangedSets?: number;
  scanErrorsCount?: number;
  scanIncomplete?: boolean;
  options: { maxFolders: number | null; overwrite: boolean };
  fatalError?: string;
  summary: {
    eligibleFolders: number;
    uploadedImages: number;
    updatedCardRecords: number;
    skippedExistingImages: number;
    skippedAlreadyImported: number;
    skippedUnmatchedFolders: number;
    skippedWrongImageCount: number;
    skippedStructureOddities: number;
    skippedUnresolvedFrontBack: number;
    skippedDuplicateDriveFileIds: number;
    skippedDuplicateCardTargets: number;
    failedCloudinaryUploads: number;
    failedDatabaseUpdates: number;
    foldersProcessed: number;
    foldersRemainingEligible: number;
  };
  uploaded: Array<{ folderPath: string; cardId: number; cardName: string; side: string; fileName: string; cloudinaryUrl: string }>;
  skippedExisting: Array<{ folderPath: string; cardId: number; side: string }>;
  failures: Array<{ folderPath: string; cardId: number | null; side: string | null; fileName: string; stage: 'cloudinary_upload' | 'db_update' | 'download'; error: string }>;
}

let importRunning = false;
let lastImportReport: DriveImportReport | null = null;

export function getLastDriveImportReport(): DriveImportReport | null {
  return lastImportReport;
}

export function isDriveImportRunning(): boolean {
  return importRunning;
}

const DOWNLOAD_MAX_ATTEMPTS = 5;

// Bounded network/timeout retry for image byte downloads, mirroring driveFetch:
// retry AbortError timeouts, network-level failures, HTTP 429 and 5xx with
// exponential backoff + jitter. Non-retryable errors (4xx other than 429,
// "Not an image", size caps) fail immediately. Errors retain operation + cause.
async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const op = `Drive download (${fileId})`;
  let lastErr: any = null;
  for (let attempt = 0; attempt < DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMPORT_DOWNLOAD_TIMEOUT_MS);
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal as any },
      );
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${op} failed: HTTP ${res.status} (retryable)`);
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        continue;
      }
      if (!res.ok) throw new Error(`${op} failed: HTTP ${res.status}`); // non-retryable 4xx
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) throw new Error('Empty file');
      if (buffer.length > IMPORT_MAX_IMAGE_BYTES) throw new Error(`Image too large: ${buffer.length} bytes`);
      return { buffer, contentType };
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isAbort = err?.name === 'AbortError';
      const isNetwork = isAbort
        || /fetch failed|network|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|terminated/i.test(msg)
        || (err?.cause && /ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|network/i.test(String(err.cause?.code || err.cause?.message || '')));
      // Non-retryable, already-classified failures bubble up immediately.
      if (!isNetwork && !/retryable/.test(msg)) throw err;
      lastErr = new Error(
        isAbort ? `${op} timed out after ${IMPORT_DOWNLOAD_TIMEOUT_MS}ms` : `${op} network error: ${msg}`,
        { cause: err },
      );
      if (attempt < DOWNLOAD_MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${op} failed after ${DOWNLOAD_MAX_ATTEMPTS} attempts: ${lastErr?.message || 'unknown'}`, { cause: lastErr });
}

function isRetryableCloudinaryError(err: any): boolean {
  const status = Number(err?.http_code || err?.status || 0);
  const message = String(err?.message || err);
  return status === 429
    || status >= 500
    || /timeout|timed out|network|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|fetch failed/i.test(message);
}

async function uploadDriveImageToCloudinary(
  buffer: Buffer,
  contentType: string,
  publicId: string,
): Promise<{ secure_url: string }> {
  let lastError: any = null;
  for (let attempt = 0; attempt < CLOUDINARY_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await cloudinary.uploader.upload(
        `data:${contentType};base64,${buffer.toString('base64')}`,
        {
          folder: IMPORT_FOLDER,
          public_id: publicId,
          // This deterministic object is owned by the Drive sync. Replacing an
          // orphan left by a prior failed DB transaction is safe; card URLs are
          // separately protected by an atomic "only if still NULL" update.
          overwrite: true,
          resource_type: 'image',
          timeout: IMPORT_UPLOAD_TIMEOUT_MS,
          transformation: [
            { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
            { format: 'auto' },
          ],
        },
      );
      if (!result?.secure_url) throw new Error('Cloudinary returned no URL');
      return { secure_url: result.secure_url };
    } catch (err: any) {
      lastError = err;
      if (!isRetryableCloudinaryError(err) || attempt === CLOUDINARY_MAX_ATTEMPTS - 1) break;
      await new Promise(r => setTimeout(r, backoffDelay(attempt)));
    }
  }
  throw new Error(
    `Cloudinary upload failed after ${CLOUDINARY_MAX_ATTEMPTS} attempt(s): ${String(lastError?.message || lastError)}`,
    { cause: lastError },
  );
}

/**
 * Approved front/back rule: with exactly two images, a file clearly marked
 * FRONT (or BACK) wins its side, and the unmarked paired file is the opposite
 * side. Sort order alone is NOT used.
 */
function resolveFrontBack(files: DriveItem[]): { front: DriveItem; back: DriveItem } | null {
  if (files.length !== 2) return null;
  const [a, b] = files;
  const sa = inferSide(a.name);
  const sb = inferSide(b.name);
  if (sa === 'front' && sb === 'back') return { front: a, back: b };
  if (sa === 'back' && sb === 'front') return { front: b, back: a };
  if (sa === 'front' && sb === 'ambiguous') return { front: a, back: b };
  if (sb === 'front' && sa === 'ambiguous') return { front: b, back: a };
  if (sa === 'back' && sb === 'ambiguous') return { front: b, back: a };
  if (sb === 'back' && sa === 'ambiguous') return { front: a, back: b };
  return null; // both ambiguous or both claim the same side → skip
}

export async function runDriveImageImport(options: {
  maxFolders?: number | null;
  mode?: 'incremental' | 'full_audit';
} = {}): Promise<DriveImportReport> {
  if (importRunning) throw new Error('A Drive image import is already in progress');
  if (running) throw new Error('A Drive dry-run is in progress — wait for it to finish');
  importRunning = true;
  const maxFolders = options.maxFolders ?? null;
  // Strict invariant: this importer never overwrites a populated card image.
  const overwrite = false;
  const mode: 'incremental' | 'full_audit' = options.mode ?? 'incremental';
  const batchId = crypto.randomUUID();
  const startedAt = Date.now();

  const report: DriveImportReport = {
    batchId,
    ranAt: new Date().toISOString(),
    status: 'running',
    mode,
    incrementalStrategy: mode === 'full_audit' ? 'full_audit' : 'checkpoint_cache',
    options: { maxFolders, overwrite },
    summary: {
      eligibleFolders: 0, uploadedImages: 0, updatedCardRecords: 0,
      skippedExistingImages: 0, skippedAlreadyImported: 0,
      skippedUnmatchedFolders: 0, skippedWrongImageCount: 0,
      skippedStructureOddities: 0, skippedUnresolvedFrontBack: 0,
      skippedDuplicateDriveFileIds: 0, skippedDuplicateCardTargets: 0,
      failedCloudinaryUploads: 0, failedDatabaseUpdates: 0,
      foldersProcessed: 0, foldersRemainingEligible: 0,
    },
    uploaded: [], skippedExisting: [], failures: [],
  };
  lastImportReport = report;

  // Cursor is NEVER advanced/established until the WHOLE job completes cleanly.
  // We compute the token to persist up-front but hold it here until the end.
  //   - pendingCursorToken: advance the existing cursor to this (changes_cursor)
  //   - pendingBaselineToken: establish a fresh baseline (baseline_full/full_audit)
  // Only one is set per run, and only saved after a clean, complete job.
  let pendingCursorToken: string | null = null;
  let pendingBaselineToken: string | null = null;
  // Sets touched by a FAILED download/upload/db-update this run. Their
  // checkpoints are marked incomplete at the end so a later incremental run
  // rescans and retries them even if Drive itself did not change.
  const failedSetFolderIds = new Set<string>();

  // Durable, DB-backed job row (survives restarts; drives the report endpoint).
  // Created inside try so a create failure still resets importRunning.
  let tracker: DriveSyncJobTracker | null = null;
  let lockAcquired = false;
  let lockClient: Awaited<ReturnType<typeof pool.connect>> | null = null;
  try {
    // Session advisory locks must be acquired and released on the SAME pooled
    // connection. Using db.execute() for these calls can pick two different
    // sessions and leave a lock stranded in the pool.
    lockClient = await pool.connect();
    const lockResult = await lockClient.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [IMPORT_LOCK_KEY],
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);
    if (!lockAcquired) throw new Error('Another instance is running the Drive import');

    // Create the visible durable job only after owning the cross-instance lock.
    // A racing instance that loses the lock must not insert a newer failed row
    // that hides the real running job in the admin status endpoint.
    tracker = await DriveSyncJobTracker.create({
      batchId, jobType: 'import', mode, stage: 'starting',
      options: { maxFolders, overwrite: false, mode },
    });

    console.log(`[DriveImport] Batch ${batchId} started (mode=${mode}, maxFolders=${maxFolders ?? 'all'}, overwrite=${overwrite})`);

    // Decide incremental targeting BEFORE the scan.
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!rootId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured');
    let forceSetIds: Set<string> | undefined;
    let effectiveMode: 'incremental' | 'full_audit' = mode;

    if (mode === 'full_audit') {
      // Capture the baseline cursor BEFORE crawling so any change that happens
      // DURING the scan is still seen by the next incremental run. It is only
      // persisted after a clean, complete audit.
      try {
        pendingBaselineToken = await fetchStartPageToken();
      } catch (e: any) {
        console.error('[DriveImport] Could not pre-capture baseline cursor:', e?.message || e);
        pendingBaselineToken = null;
      }
    } else {
      // Incremental.
      await tracker?.update({ stage: 'computing changes' });
      const state = await loadSyncState();
      const hasCursor = !!state?.changesPageToken;

      const prepareRecoveryFullAudit = async (reason: string) => {
        report.incrementalStrategy = 'full_audit';
        effectiveMode = 'full_audit';
        forceSetIds = undefined;
        pendingCursorToken = null;
        console.warn(`[DriveImport] ${reason}; running a recovery full audit`);
        try {
          // Capture BEFORE the recovery crawl. Changes made during that crawl
          // are then visible on the next normal incremental run.
          pendingBaselineToken = await fetchStartPageToken();
        } catch (e: any) {
          pendingBaselineToken = null;
          console.error('[DriveImport] Recovery baseline cursor pre-capture failed:', e?.message || e);
        }
      };

      if (!hasCursor) {
        // No trustworthy cursor means checkpoints alone cannot prove that a
        // deeply nested Drive file stayed unchanged. Establish a fresh, exact
        // baseline with a full crawl before normal incremental syncs begin.
        report.incrementalStrategy = 'baseline_full';
        effectiveMode = 'full_audit';
        try {
          pendingBaselineToken = await fetchStartPageToken();
        } catch (e: any) {
          console.error('[DriveImport] Baseline cursor pre-capture failed:', e?.message || e);
          pendingBaselineToken = null;
        }
        console.log('[DriveImport] No cursor/checkpoints — running as baseline_full');
      } else {
        try {
          const changes = await computeAffectedSetsFromChanges(rootId);
          if (changes) {
            // Preferred: Changes API cursor. Only affected top-level sets are
            // scanned; every other set is skipped via checkpoint cache.
            report.incrementalStrategy = 'changes_cursor';
            report.affectedSetIds = Array.from(changes.affected);
            report.unresolvedChanges = changes.unresolved;
            if (changes.unresolved > 0) {
              // Never advance past a change that could not be mapped to a set.
              // A direct-child checkpoint signature cannot safely detect every
              // deeply nested file change, so recover with a full audit.
              await prepareRecoveryFullAudit(
                `${changes.unresolved} Drive change(s) could not be mapped to a top-level set`,
              );
            } else {
              // DEFER advancing the cursor until the whole job completes cleanly.
              pendingCursorToken = changes.newToken;
              forceSetIds = changes.affected;
              console.log(`[DriveImport] Changes cursor: ${changes.affected.size} affected set(s)`);
            }
          } else {
            await prepareRecoveryFullAudit('Drive Changes targeting returned no usable cursor');
          }
        } catch (e: any) {
          await prepareRecoveryFullAudit(`Drive Changes targeting failed: ${e?.message || e}`);
        }
      }
    }

    // Run a FRESH read-only scan (mode-aware) so eligibility reflects current
    // Drive structure and card data — never a stale report. Incremental mode
    // skips unchanged completed sets via checkpoints; full_audit crawls all.
    const scan = await runDriveImageSyncDryRun({ mode: effectiveMode, tracker, forceSetIds });
    report.skippedUnchangedSets = scan.skippedUnchangedSets.length;
    report.scanErrorsCount = scan.scanErrors.length;
    report.scanIncomplete = scan.incomplete;

    // If the scan was incomplete (scan errors forced unsafe-subtree skips, or it
    // hit MAX_FOLDER_LISTINGS) we must NOT establish/advance any cursor: a later
    // run must be free to re-examine everything.
    if (scan.incomplete) {
      pendingCursorToken = null;
      pendingBaselineToken = null;
      console.warn('[DriveImport] Scan incomplete — cursor will NOT be advanced/established this run');
    }

    // Sets of paths/ids that must never import
    const duplicateFileIds = new Set(scan.duplicateDriveFileIdList.map(d => d.driveFileId));
    const duplicateCardIds = new Set(scan.duplicateCardMatchList.map(d => d.cardId));
    const oddityPaths = new Set(scan.unexpectedStructures.map(u => u.path));

    // Prior successful imports (idempotency ledger): fileId → modifiedTime
    const priorRows = await db
      .select({
        driveFileId: driveImageImports.driveFileId,
        driveModifiedTime: driveImageImports.driveModifiedTime,
      })
      .from(driveImageImports)
      .where(eq(driveImageImports.status, 'uploaded'));
    const priorByFileId = new Map(priorRows.map(r => [r.driveFileId, r.driveModifiedTime]));

    // Image file details per folder (need Drive file ids + modifiedTime)
    const filesByFolder = new Map<string, ImageFileReport[]>();
    for (const f of scan.allImageFiles) {
      const arr = filesByFolder.get(f.parentPath) || [];
      arr.push(f);
      filesByFolder.set(f.parentPath, arr);
    }

    // Current card image state for matched cards
    const matchedCardIds = Array.from(new Set(
      scan.allCardFolders.filter(f => f.match.status === 'matched' && f.match.cardId != null).map(f => f.match.cardId!)
    ));
    const cardRows = matchedCardIds.length
      ? await db.select({ id: cards.id, name: cards.name, frontImageUrl: cards.frontImageUrl, backImageUrl: cards.backImageUrl })
          .from(cards).where(inArray(cards.id, matchedCardIds))
      : [];
    const cardById = new Map(cardRows.map(c => [c.id, c]));

    // Build the eligible list with every exclusion counted
    interface EligibleFolder { folder: CardFolderReport; front: ImageFileReport; back: ImageFileReport; }
    const eligible: EligibleFolder[] = [];

    for (const folder of scan.allCardFolders) {
      if (folder.match.status !== 'matched' || folder.match.cardId == null) {
        report.summary.skippedUnmatchedFolders++;
        continue;
      }
      if (folder.imageCount !== 2) {
        report.summary.skippedWrongImageCount++;
        continue;
      }
      if (folder.hasNestedFolders || folder.nonImageCount > 0 || oddityPaths.has(folder.path)) {
        report.summary.skippedStructureOddities++;
        continue;
      }
      const files = filesByFolder.get(folder.path) || [];
      if (files.some(f => duplicateFileIds.has(f.driveFileId))) {
        report.summary.skippedDuplicateDriveFileIds++;
        continue;
      }
      if (duplicateCardIds.has(folder.match.cardId)) {
        report.summary.skippedDuplicateCardTargets++;
        continue;
      }
      const items: DriveItem[] = files.map(f => ({ id: f.driveFileId, name: f.fileName, mimeType: f.mimeType, modifiedTime: f.modifiedTime }));
      const resolved = resolveFrontBack(items);
      if (!resolved) {
        report.summary.skippedUnresolvedFrontBack++;
        continue;
      }
      const frontFile = files.find(f => f.driveFileId === resolved.front.id)!;
      const backFile = files.find(f => f.driveFileId === resolved.back.id)!;
      eligible.push({ folder, front: frontFile, back: backFile });
    }

    report.summary.eligibleFolders = eligible.length;
    console.log(`[DriveImport] ${eligible.length} eligible folders out of ${scan.allCardFolders.length} scanned`);

    // Any per-item failure for a set flags its checkpoint incomplete so a later
    // incremental run rescans/retries it even if Drive is unchanged.
    const markSetFailed = (setFolderId: string | undefined) => {
      if (setFolderId) failedSetFolderIds.add(setFolderId);
    };

    // Per-set eligible-folder counts, so a maxFolders-limited run never marks a
    // set completed whose eligible folders weren't all processed this run.
    const eligibleCountBySet = new Map<string, number>();
    for (const e of eligible) {
      const sid = e.folder.setFolderId;
      if (sid) eligibleCountBySet.set(sid, (eligibleCountBySet.get(sid) ?? 0) + 1);
    }

    const toProcess = maxFolders != null ? eligible.slice(0, maxFolders) : eligible;
    report.summary.foldersRemainingEligible = eligible.length - toProcess.length;

    // Count how many of each set's eligible folders are actually in this run's
    // processing slice. A set is "fully processed" only when this equals its
    // total eligible count (i.e., maxFolders did not cut it off).
    const processedCountBySet = new Map<string, number>();
    for (const e of toProcess) {
      const sid = e.folder.setFolderId;
      if (sid) processedCountBySet.set(sid, (processedCountBySet.get(sid) ?? 0) + 1);
    }
    await tracker?.update({ stage: 'uploading', skippedSetsUnchanged: scan.skippedUnchangedSets.length, scanErrorsCount: scan.scanErrors.length });

    // Time-based heartbeat so a single slow upload can never let the job be
    // auto-marked interrupted (stale = no heartbeat for 5 min). We heartbeat at
    // least this often regardless of folder count.
    const HEARTBEAT_INTERVAL_MS = 60 * 1000;
    let lastHeartbeat = Date.now();
    const maybeHeartbeat = async () => {
      if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = Date.now();
        await tracker?.update({
          cardFoldersProcessed: report.summary.foldersProcessed,
          imagesUploaded: report.summary.uploadedImages,
          cardsUpdated: report.summary.updatedCardRecords,
        });
      }
    };

    for (const { folder, front, back } of toProcess) {
      const cardId = folder.match.cardId!;
      const card = cardById.get(cardId);
      if (!card) {
        report.summary.skippedUnmatchedFolders++;
        markSetFailed(folder.setFolderId);
        continue;
      }
      report.summary.foldersProcessed++;
      await maybeHeartbeat();
      if (report.summary.foldersProcessed % 10 === 0) {
        await tracker?.update({
          cardFoldersProcessed: report.summary.foldersProcessed,
          imagesUploaded: report.summary.uploadedImages,
          cardsUpdated: report.summary.updatedCardRecords,
          currentSet: folder.mainSet,
        });
        lastHeartbeat = Date.now();
      }

      const sides: Array<{ side: 'front' | 'back'; file: ImageFileReport; existingUrl: string | null }> = [
        { side: 'front', file: front, existingUrl: card.frontImageUrl },
        { side: 'back', file: back, existingUrl: card.backImageUrl },
      ];

      for (const { side, file, existingUrl } of sides) {
        // Idempotency: already imported and unchanged → skip
        if (priorByFileId.has(file.driveFileId) && priorByFileId.get(file.driveFileId) === (file.modifiedTime ?? null)) {
          report.summary.skippedAlreadyImported++;
          continue;
        }
        // Never overwrite existing card images.
        if (existingUrl) {
          report.summary.skippedExistingImages++;
          report.skippedExisting.push({ folderPath: folder.path, cardId, side });
          continue;
        }

        // Heartbeat right before the slow network work so a long download/upload
        // cannot cross the stale threshold mid-operation.
        await maybeHeartbeat();
        let cloudinaryUrl = '';
        let publicId = `card_${cardId}_${side}`;
        // Keep the durable lease heartbeat fresh independently of individual
        // awaits. This covers download retries and any slow Cloudinary attempt.
        const networkHeartbeat = setInterval(() => {
          void tracker?.heartbeat();
        }, HEARTBEAT_INTERVAL_MS);
        try {
          const { buffer, contentType } = await downloadDriveFile(file.driveFileId);
          const result = await uploadDriveImageToCloudinary(buffer, contentType, publicId);
          cloudinaryUrl = result.secure_url;
        } catch (err: any) {
          const stage = String(err?.message || '').includes('Drive download') || String(err?.message || '').includes('Not an image') ? 'download' : 'cloudinary_upload';
          report.summary.failedCloudinaryUploads++;
          report.failures.push({ folderPath: folder.path, cardId, side, fileName: file.fileName, stage, error: String(err?.message || err).slice(0, 300) });
          await db.insert(driveImageImports).values({
            driveFileId: file.driveFileId, driveFileName: file.fileName,
            driveModifiedTime: file.modifiedTime ?? null, driveFolderPath: folder.path,
            cardId, imageType: side, importBatchId: batchId,
            status: 'failed_upload', error: String(err?.message || err).slice(0, 500),
          }).catch(() => {});
          // Do not strand the failure: flag this set so a later incremental run
          // rescans and retries it even if Drive itself did not change.
          markSetFailed(folder.setFolderId);
          continue;
        } finally {
          clearInterval(networkHeartbeat);
        }

        // Update the card record (only after a confirmed upload). The card URL
        // swap and the ledger row commit together so resumability stays accurate.
        // The IS NULL predicate closes the race between the earlier card snapshot
        // and this write: a concurrent admin/user update can never be overwritten.
        try {
          const applied = await db.transaction(async (tx) => {
            const updated = await tx.update(cards)
              .set(side === 'front' ? { frontImageUrl: cloudinaryUrl } : { backImageUrl: cloudinaryUrl })
              .where(and(
                eq(cards.id, cardId),
                isNull(side === 'front' ? cards.frontImageUrl : cards.backImageUrl),
              ))
              .returning({ id: cards.id });
            if (updated.length === 0) return false;
            await tx.insert(driveImageImports).values({
              driveFileId: file.driveFileId, driveFileName: file.fileName,
              driveModifiedTime: file.modifiedTime ?? null, driveFolderPath: folder.path,
              cardId, imageType: side, cloudinaryPublicId: `${IMPORT_FOLDER}/${publicId}`,
              cloudinaryUrl, importBatchId: batchId, status: 'uploaded',
            });
            return true;
          });
          if (!applied) {
            report.summary.skippedExistingImages++;
            report.skippedExisting.push({ folderPath: folder.path, cardId, side });
            continue;
          }
          report.summary.uploadedImages++;
          report.uploaded.push({ folderPath: folder.path, cardId, cardName: card.name, side, fileName: file.fileName, cloudinaryUrl });
          // keep in-memory ledger current so a same-run duplicate can't double-import
          priorByFileId.set(file.driveFileId, file.modifiedTime ?? null);
          if (side === 'front') card.frontImageUrl = cloudinaryUrl; else card.backImageUrl = cloudinaryUrl;
        } catch (err: any) {
          report.summary.failedDatabaseUpdates++;
          report.failures.push({ folderPath: folder.path, cardId, side, fileName: file.fileName, stage: 'db_update', error: String(err?.message || err).slice(0, 300) });
          await db.insert(driveImageImports).values({
            driveFileId: file.driveFileId, driveFileName: file.fileName,
            driveModifiedTime: file.modifiedTime ?? null, driveFolderPath: folder.path,
            cardId, imageType: side, cloudinaryPublicId: `${IMPORT_FOLDER}/${publicId}`,
            cloudinaryUrl, importBatchId: batchId,
            status: 'failed_db_update', error: String(err?.message || err).slice(0, 500),
          }).catch(() => {});
          markSetFailed(folder.setFolderId);
        }
      }

      const updatedThisFolder = report.uploaded.filter(u => u.cardId === cardId).length > 0;
      if (updatedThisFolder) report.summary.updatedCardRecords++;

      await new Promise(r => setTimeout(r, IMPORT_DELAY_MS));
    }

    // ---- Persist set checkpoints AFTER uploads (resumability-correct) ----
    // The scan is read-only and writes no checkpoints. Only NOW, after this
    // set's eligible upload work is done, may a set be marked completed — and
    // only when ALL of the following hold:
    //   (a) cleanlyScanned: no scan error touched its subtree, AND
    //   (b) either it was skipped-as-unchanged (already imported) OR every one
    //       of its eligible folders was processed this run (maxFolders did not
    //       cut it off), AND
    //   (c) it had zero per-item upload/db failures this run.
    // Anything failing (a)–(c) is written as completed=false so the next
    // incremental run rescans it and no pending image is ever skipped.
    // NOTE ON STREAMING: we do NOT stream scan+upload per set; a mid-run crash
    // may redo the scan on restart, but because no checkpoint is completed until
    // its uploads finish, a restart can NEVER skip a set with pending images.
    let setsMarkedComplete = 0;
    let setsMarkedIncomplete = 0;
    for (const meta of scan.setScanMeta) {
      const sid = meta.driveFolderId;
      const hadFailure = failedSetFolderIds.has(sid);
      const totalEligible = eligibleCountBySet.get(sid) ?? 0;
      const processed = processedCountBySet.get(sid) ?? 0;
      const fullyProcessed = processed >= totalEligible; // 0>=0 → true (no eligible work)
      const completed = decideSetCheckpointCompleted({
        cleanlyScanned: meta.cleanlyScanned, hadFailure,
        skippedUnchanged: meta.skippedUnchanged, totalEligible, processed,
      });
      await upsertSetCheckpoint({
        driveFolderId: sid,
        folderName: meta.folderName,
        contentSignature: meta.contentSignature,
        lastModifiedTime: meta.lastModifiedTime,
        completed,
        batchId,
      }).catch((e) => console.error('[DriveImport] set checkpoint write error:', e?.message || e));
      if (completed) setsMarkedComplete++; else setsMarkedIncomplete++;
      if (!completed && !meta.cleanlyScanned) {
        console.warn(`[DriveImport] set "${meta.folderName}" left incomplete (scan error in subtree)`);
      } else if (!completed && !meta.skippedUnchanged && !fullyProcessed) {
        console.warn(`[DriveImport] set "${meta.folderName}" left incomplete (maxFolders cut off ${totalEligible - processed} of ${totalEligible} eligible folders)`);
      }
    }
    console.log(`[DriveImport] Checkpoints written: ${setsMarkedComplete} completed, ${setsMarkedIncomplete} incomplete`);

    // Belt-and-suspenders: any set that had a failed download/upload/db-update
    // this run is force-reset to incomplete (in case a stale completed row from
    // a prior run existed and this run didn't rewrite it above).
    for (const setFolderId of failedSetFolderIds) {
      await db.update(driveSyncSetCheckpoints)
        .set({ completed: false })
        .where(eq(driveSyncSetCheckpoints.driveFolderId, setFolderId))
        .catch((e) => console.error('[DriveImport] failed-set checkpoint reset error:', e?.message || e));
    }
    if (failedSetFolderIds.size > 0) {
      console.warn(`[DriveImport] ${failedSetFolderIds.size} set(s) had failures; checkpoints reset for retry on next incremental run`);
    }

    // The cursor/baseline may only be persisted after a fully clean, complete
    // job: no fatal error (we're in the success path), the scan was complete,
    // AND no per-item failures were stranded this run. Anything less and we
    // leave the cursor untouched so the next run can re-examine changes safely.
    const cleanComplete = !report.scanIncomplete && failedSetFolderIds.size === 0
      && report.summary.failedCloudinaryUploads === 0 && report.summary.failedDatabaseUpdates === 0;

    if (cleanComplete && pendingBaselineToken) {
      await saveBaselineCursor(pendingBaselineToken);
      console.log('[DriveImport] Baseline Changes cursor established (post-completion)');
    } else if (cleanComplete && pendingCursorToken) {
      await saveCursor(pendingCursorToken);
      console.log('[DriveImport] Changes cursor advanced (post-completion)');
    } else if (!cleanComplete && (pendingBaselineToken || pendingCursorToken)) {
      console.warn('[DriveImport] Job not fully clean — cursor NOT advanced/established (will retry next run)');
    }

    report.status = 'completed';
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;

    // Persist ALL final counters BEFORE closing the tracker (finish() sets the
    // tracker closed, after which update() is a no-op — so counters must go first).
    await tracker?.update({
      stage: 'done',
      imagesUploaded: report.summary.uploadedImages,
      cardsUpdated: report.summary.updatedCardRecords,
      cardFoldersProcessed: report.summary.foldersProcessed,
      scanErrorsCount: report.scanErrorsCount,
      skippedSetsUnchanged: report.skippedUnchangedSets,
    });
    await tracker?.finish('completed', {
      stage: 'done',
      detail: {
        summary: report.summary, mode: report.mode,
        incrementalStrategy: report.incrementalStrategy,
        affectedSetIds: report.affectedSetIds,
        skippedUnchangedSets: report.skippedUnchangedSets,
        scanErrorsCount: report.scanErrorsCount,
        scanIncomplete: report.scanIncomplete,
        cursorAdvanced: cleanComplete && (!!pendingBaselineToken || !!pendingCursorToken),
        failedSets: failedSetFolderIds.size,
      },
    });
    console.log(`[DriveImport] Batch ${batchId} completed in ${report.durationMs}ms (mode=${report.mode}, strategy=${report.incrementalStrategy}): ${report.summary.uploadedImages} images uploaded, ${report.summary.updatedCardRecords} cards updated, ${report.summary.skippedExistingImages} existing skipped, ${report.summary.skippedAlreadyImported} already-imported skipped, ${report.summary.failedCloudinaryUploads + report.summary.failedDatabaseUpdates} failures`);
    return report;
  } catch (err: any) {
    report.status = 'failed';
    report.fatalError = String(err?.message || err);
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    // Never advance the cursor on a failed job (defensive; already deferred).
    await tracker?.finish('failed', { stage: 'failed', latestError: String(err?.message || err).slice(0, 500) });
    console.error(`[DriveImport] Batch ${batchId} failed:`, err?.message || err);
    throw err;
  } finally {
    if (lockClient) {
      if (lockAcquired) {
        await lockClient.query(
          'SELECT pg_advisory_unlock(hashtext($1))',
          [IMPORT_LOCK_KEY],
        ).catch((e) => console.error('[DriveImport] Advisory unlock failed:', e?.message || e));
      }
      lockClient.release();
    }
    importRunning = false;
  }
}

import { randomUUID } from 'node:crypto';
import { isVisualScanEnabled } from '../scanRuntime';

export const DEV_SCAN_MAX_TOTAL_MS = 30 * 60 * 1000;
export interface DevScanEventPatch {
  pickedCardId?: number | null;
  usedSearch?: boolean;
  photoSubmitUsed?: boolean;
  totalMs?: number;
}
export interface DevScanEventOutcome {
  status: 'success' | 'error';
  topScore: number | null;
  margin: number | null;
  serverMs: number;
  rankedCardIds?: number[];
}
/** Only scalar metadata crosses this boundary, never an image or request. */
export interface DevScanTelemetry {
  begin(userId: number): Promise<string>;
  finish(id: string, userId: number, outcome: DevScanEventOutcome): Promise<void>;
  patch(id: string, userId: number, patch: DevScanEventPatch): Promise<void>;
}
export class DevScanTelemetryError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
export function assertDevScanTelemetryDatabase(env: NodeJS.ProcessEnv = process.env): void {
  if (!isVisualScanEnabled(env)) throw new Error('Visual scan telemetry is disabled');
}
export function validateDevScanEventPatch(value: unknown): DevScanEventPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DevScanTelemetryError(400, 'Send a telemetry update object');
  }
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key]) =>
    !['pickedCardId', 'usedSearch', 'photoSubmitUsed', 'totalMs'].includes(key))) {
    throw new DevScanTelemetryError(400, 'Unknown or missing telemetry fields');
  }
  for (const [key, field] of entries) {
    if (key === 'pickedCardId') {
      if (field !== null && (!Number.isSafeInteger(field) || (field as number) <= 0 || (field as number) > 2147483647)) {
        throw new DevScanTelemetryError(400, 'pickedCardId must be a positive card ID or null');
      }
    } else if (key === 'totalMs') {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > DEV_SCAN_MAX_TOTAL_MS) {
        throw new DevScanTelemetryError(400, 'totalMs must be between 0 and 1800000');
      }
    } else if (typeof field !== 'boolean') {
      throw new DevScanTelemetryError(400, `${key} must be boolean`);
    }
  }
  return value as DevScanEventPatch;
}
export function isDevScanEventId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export interface DevScanTelemetryDatabase {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
type DatabaseProvider = () => Promise<DevScanTelemetryDatabase>;
async function realDatabase(): Promise<DevScanTelemetryDatabase> {
  const { pool } = await import('../db');
  // Verify the actual pool target as well as the current environment.
  assertDevScanTelemetryDatabase({ ...process.env, DATABASE_URL: pool.options.connectionString });
  return pool;
}
export class DevScanTelemetryWriter implements DevScanTelemetry {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly database: DatabaseProvider = realDatabase,
  ) {}
  private async connection() {
    assertDevScanTelemetryDatabase(this.env);
    return this.database();
  }
  /** Called only by gate-on DEV startup, never lazily by a request. */
  async initialize(): Promise<void> {
    const db = await this.connection();
    await db.query(`CREATE TABLE IF NOT EXISTS dev_scan_events (
      id uuid PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status text NOT NULL CHECK (status IN ('processing', 'success', 'error')),
      top_score double precision,
      margin double precision,
      picked_card_id integer,
      used_search boolean NOT NULL DEFAULT false,
      photo_submit_used boolean NOT NULL DEFAULT false,
      total_ms double precision CHECK (total_ms >= 0 AND total_ms <= 1800000),
      server_ms double precision CHECK (server_ms >= 0),
      ranked_card_ids jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async begin(userId: number): Promise<string> {
    const db = await this.connection();
    const id = randomUUID();
    const result = await db.query(
      `INSERT INTO dev_scan_events (id, user_id, status) VALUES ($1, $2, 'processing') RETURNING id`,
      [id, userId],
    );
    if (!result.rows.length) throw new Error('Development scan event was not created');
    return id;
  }
  async finish(id: string, userId: number, outcome: DevScanEventOutcome): Promise<void> {
    const db = await this.connection();
    const result = await db.query(
      `UPDATE dev_scan_events SET status = $3, top_score = $4, margin = $5, server_ms = $6, ranked_card_ids = $7::jsonb
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId, outcome.status, outcome.topScore, outcome.margin, outcome.serverMs, JSON.stringify(outcome.rankedCardIds ?? null)],
    );
    if (!result.rows.length) throw new Error('Development scan event is missing');
  }
  async patch(id: string, userId: number, input: DevScanEventPatch): Promise<void> {
    const patch = validateDevScanEventPatch(input);
    const db = await this.connection();
    const owned = await db.query('SELECT id FROM dev_scan_events WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!owned.rows.length) throw new DevScanTelemetryError(404, 'Scan event not found');
    const result = await db.query(
      `UPDATE dev_scan_events SET
         picked_card_id = CASE WHEN $3 THEN $4::integer ELSE picked_card_id END,
         used_search = used_search OR $5::boolean,
         photo_submit_used = photo_submit_used OR $6::boolean,
         total_ms = COALESCE(total_ms, $7::double precision)
       WHERE id = $1 AND user_id = $2 AND (
         NOT $3::boolean OR $4::integer IS NULL OR EXISTS (
           SELECT 1 FROM cards c JOIN card_sets cs ON cs.id = c.set_id
           LEFT JOIN main_sets ms ON ms.id = cs.main_set_id
           WHERE c.id = $4::integer AND c.archived_at IS NULL
             AND cs.archived_at IS NULL AND cs.is_active = true
             AND (ms.id IS NULL OR (ms.archived_at IS NULL AND ms.is_active = true))
         )
       ) RETURNING id`,
      [id, userId, Object.prototype.hasOwnProperty.call(patch, 'pickedCardId'), patch.pickedCardId ?? null,
        patch.usedSearch ?? false, patch.photoSubmitUsed ?? false, patch.totalMs ?? null],
    );
    if (!result.rows.length) throw new DevScanTelemetryError(400, 'pickedCardId must identify an active DEV card');
  }
}
export const devScanTelemetry: DevScanTelemetry = new DevScanTelemetryWriter();
export async function initializeDevScanTelemetry(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!isVisualScanEnabled(env)) return;
  await new DevScanTelemetryWriter(env).initialize();
}
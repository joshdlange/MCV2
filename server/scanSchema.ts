import { pool } from './db';

/** Additive only: never run db:push or change existing tables for this release. */
export const SCAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dev_scan_events (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('processing','success','error')),
  top_score double precision,
  margin double precision,
  picked_card_id integer,
  used_search boolean NOT NULL DEFAULT false,
  photo_submit_used boolean NOT NULL DEFAULT false,
  total_ms double precision CHECK (total_ms >= 0 AND total_ms <= 1800000),
  server_ms double precision CHECK (server_ms >= 0),
  ranked_card_ids jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dev_scan_reference_overrides (
  card_id integer PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  model_version text NOT NULL,
  embedding jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_scan_logs (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_visual_references (
  key text PRIMARY KEY,
  model_version text NOT NULL,
  reference_url text NOT NULL,
  content_digest text,
  embedding jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  retry_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pending_card_images (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  card_id integer NOT NULL REFERENCES cards(id),
  front_image_url text,
  back_image_url text,
  status text NOT NULL DEFAULT 'pending',
  source text NOT NULL DEFAULT 'manual_upload',
  rejection_reason text,
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
`;

export async function initializeScanSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('visual-scan-schema'))");
    await client.query(SCAN_SCHEMA_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
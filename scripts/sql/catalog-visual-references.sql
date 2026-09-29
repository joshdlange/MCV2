-- OPTIONAL MANUAL ADDITIVE CATALOG VISUAL SCHEMA.
-- Mirrors the parent-owned isolated startup transaction for this project's
-- externally managed database, where legacy duplicates block db:push.
-- This file itself is never auto-executed by startup/build.
-- First verify the deployed application's actual database target.
-- For Replit-managed production: use its supported Publish schema-diff flow.
-- For an externally managed Neon target: an authorized operator may apply this
-- transaction using that project's established database migration connection.
-- Do not assume DATABASE_URL and NEON_DATABASE_URL refer to the same database.
-- No catalog cards/images are changed. No extension/pgvector is required.
BEGIN;
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
CREATE INDEX IF NOT EXISTS catalog_visual_model_status_idx
  ON catalog_visual_references (model_version, status);
CREATE INDEX IF NOT EXISTS catalog_visual_digest_idx
  ON catalog_visual_references (model_version, content_digest);
COMMIT;
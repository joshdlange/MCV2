import { sql } from "drizzle-orm";
import { assertDevScanTelemetryDatabase } from "./devScanTelemetry";
import { isDevScanVisualEnabled } from "./devScanVisual";
import { downloadPublicImage } from "./imageMigration";
import { embedCatalogVisualImage, MODEL_VERSION } from "./catalogVisualModel";

export async function initializeDevScanReferences() {
  assertDevScanTelemetryDatabase();
  const { pool } = await import("../db");
  await pool.query(`CREATE TABLE IF NOT EXISTS dev_scan_reference_overrides (
    card_id integer PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    image_url text NOT NULL, model_version text NOT NULL,
    embedding jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

/** Prepare before committing the image. Failure leaves the existing image/index intact. */
export async function prepareDevScanReference(url: string | null | undefined) {
  if (!isDevScanVisualEnabled() || url === undefined) return null;
  assertDevScanTelemetryDatabase();
  if (!url) return { url: "", vector: null };
  const { buffer } = await downloadPublicImage(url);
  const vector = await embedCatalogVisualImage(buffer, "background", { offline: true });
  return { url, vector };
}

export async function saveDevScanReference(tx: { execute: Function }, cardId: number,
  reference: Awaited<ReturnType<typeof prepareDevScanReference>>) {
  if (!reference) return;
  assertDevScanTelemetryDatabase();
  await tx.execute(sql`INSERT INTO dev_scan_reference_overrides(card_id,image_url,model_version,embedding)
    VALUES (${cardId},${reference.url},${MODEL_VERSION},${JSON.stringify(reference.vector)}::jsonb)
    ON CONFLICT(card_id) DO UPDATE SET image_url=excluded.image_url,
      model_version=excluded.model_version,embedding=excluded.embedding,updated_at=now()`);
}

export async function readDevScanReferences() {
  assertDevScanTelemetryDatabase();
  const { pool } = await import("../db");
  return (await pool.query(`SELECT r.card_id, coalesce(c.front_image_url,'') AS image_url,
    CASE WHEN r.image_url=c.front_image_url AND r.model_version=$1
      THEN r.embedding ELSE NULL END AS embedding
    FROM dev_scan_reference_overrides r JOIN cards c ON c.id=r.card_id`,
    [MODEL_VERSION])).rows;
}
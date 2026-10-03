/**
 * Explicitly requested read-only DEV fixture export. No app API/auth bypass.
 * Does not call initializeDevScanVisual (its reference initializer performs DDL).
 * NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on npx tsx client/scan-qa/export-fixture.ts
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { browseDevScanCatalog, searchDevScanCatalog, scanEligible } from "../../server/services/devScanBrowse";
import { assertDevScanTelemetryDatabase } from "../../server/services/devScanTelemetry";
import { DevScanVisualService, loadDevScanFrozenIndex, type DevScanCatalogCard } from "../../server/services/devScanVisual";
import { VECTOR_DIMENSIONS } from "../../server/services/catalogVisualModel";

assertDevScanTelemetryDatabase();
const { db, pool, healthPool } = await import("../../server/db");
try {
  const { index, matrix } = await loadDevScanFrozenIndex();
  const catalog = (await db.execute(sql`WITH eligible AS (${scanEligible})
    SELECT id,name,card_number AS "cardNumber",set_id AS "setId",main_set_id AS "mainSetId",
      front_image_url AS "frontImageUrl",variation,is_insert AS "isInsert",
      set_name AS "setName",set_year AS "setYear",parent_name AS "mainSetName",
      is_insert_subset AS "isInsertSubset",true AS active FROM eligible`)).rows as unknown as DevScanCatalogCard[];
  const service = new DevScanVisualService(index, matrix, catalog);
  const referenceId = Number(process.env.SCAN_QA_REFERENCE_ID || 16483);
  const referenceIndex = index.rows.findIndex(row => row.cardIds.includes(referenceId));
  assert.ok(referenceIndex >= 0, "Actual Darkhawk reference vector must exist");
  const vector = Array.from(matrix.subarray(referenceIndex * VECTOR_DIMENSIONS, (referenceIndex + 1) * VECTOR_DIMENSIONS));
  const result = service.rankVectors([vector]);
  assert.ok(result.families.length > 1);
  assert.ok(result.browseHint?.year, "Real ranked result provides a browse hint");
  const hint = result.browseHint!;
  const years = await browseDevScanCatalog("years", {});
  const sets = await browseDevScanCatalog("sets", { year: hint.year! }) as any[];
  const selectedMainSet = sets.find(set => set.id === hint.mainSetId);
  assert.ok(selectedMainSet, "Ranked original set appears in year browse");
  const subsets = await browseDevScanCatalog("subsets", { year: hint.year!, mainSetId: hint.mainSetId! }) as any[];
  const cards: Record<string, unknown[]> = {};
  for (const subset of subsets) cards[subset.id] = await browseDevScanCatalog("cards", { setId: subset.id }) as unknown[];
  const search = await searchDevScanCatalog("darkhawk 11 1992");
  assert.equal(search[0]?.cardId, 16483, "Real global token search ranks original base first");
  const images: Record<string, string> = {};
  try {
    const previous = JSON.parse(await readFile("client/scan-qa/catalog-fixture.json", "utf8"));
    Object.assign(images, previous.images ?? {});
  } catch { /* First export has no cached artwork. */ }
  const imageDir = path.resolve("client/scan-qa/images");
  await mkdir(imageDir, { recursive: true });
  // Cache a small relevant artwork sample with its real URL. No placeholder,
  // repeated stand-in, or network request from the capture browser.
  const urls = new Set<string>();
  for (const family of result.families) for (const card of family.options) if (card.imageUrl) urls.add(card.imageUrl);
  for (const card of search) if (card.imageUrl) urls.add(card.imageUrl as string);
  for (const subset of subsets.slice(0, 2)) for (const card of (cards[subset.id] as any[]).slice(0, 6)) if (card.frontImageUrl) urls.add(card.frontImageUrl);
  let ordinal = Object.keys(images).length;
  for (const url of urls) {
    if (images[url]) continue;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) continue;
      const extension = response.headers.get("content-type")?.includes("png") ? "png" : "jpg";
      const imagePath = path.join(imageDir, `${++ordinal}.${extension}`);
      await writeFile(imagePath, Buffer.from(await response.arrayBuffer()));
      images[url] = path.relative(process.cwd(), imagePath);
    } catch { /* Unavailable real images remain explicit no-photo fallbacks. */ }
  }
  const fixture = {
    source: `Helium DEV read-only catalog export ${new Date().toISOString()}; actual frozen reference vector card ${referenceId}; real service.rankVectors; no query/photo recognition performed`,
    ...result, years, sets: { [hint.year!]: sets },
    subsets: { [`${hint.mainSetId}:${hint.year}`]: subsets }, cards,
    search: { "darkhawk 11 1992": search }, images,
  };
  await writeFile("client/scan-qa/catalog-fixture.json", JSON.stringify(fixture, null, 2));
  console.log(`Exported real catalog fixture: ${result.families.length} ranked families, ${search.length} search rows, ${ordinal} local images`);
} finally {
  await Promise.all([pool.end(), healthPool.end()]);
}
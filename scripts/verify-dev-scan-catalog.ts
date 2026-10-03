/** Read-only real DEV catalog regressions; no production connection or writes. */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { searchDevScanCatalog, browseDevScanCatalog } from "../server/services/devScanBrowse";
import { loadDevScanFrozenIndex, DevScanVisualService } from "../server/services/devScanVisual";
import { assertDevScanTelemetryDatabase } from "../server/services/devScanTelemetry";
assertDevScanTelemetryDatabase();
const { pool } = await import("../server/db");
try {
  for (const [query,id] of [["darkhawk 11 1992",16483],["colossus 11 2008",22723],["ghost rider 28 2008",22759]] as const) {
    const rows = await searchDevScanCatalog(query);
    assert.equal(rows[0]?.cardId,id,query);
    console.log("PASS",query,id);
  }
  assert.equal((await searchDevScanCatalog("1992 marvel masterpieces dark hawk"))[0]?.cardId,16483);
  const sets = await browseDevScanCatalog("sets",{year:1992}) as any[];
  assert.ok(sets.some(s=>s.id===84));
  assert.ok(sets.every(s=>s.totalCards>0));
  const catalog = (await pool.query(`SELECT c.id,c.name,c.card_number AS "cardNumber", c.front_image_url AS "frontImageUrl",
    c.variation,c.is_insert AS "isInsert",cs.id AS "setId",cs.main_set_id AS "mainSetId",
    cs.name AS "setName",cs.year AS "setYear",ms.name AS "mainSetName",cs.is_insert_subset AS "isInsertSubset",
    (c.archived_at IS NULL AND cs.archived_at IS NULL AND cs.is_active AND (ms.id IS NULL OR (ms.is_active AND ms.archived_at IS NULL))) AS active
    FROM cards c JOIN card_sets cs ON cs.id=c.set_id LEFT JOIN main_sets ms ON ms.id=cs.main_set_id`)).rows;
  const {index,matrix}=await loadDevScanFrozenIndex();
  const service = new DevScanVisualService(index,matrix,catalog);
  const row = index.rows.findIndex(r=>r.cardIds.includes(55352));
  const result = service.rankVectors([Array.from(matrix.subarray(row*384,(row+1)*384))]);
  assert.equal(result.families.length,5);
  assert.equal(result.browseHint?.year,2024,"browse starts at best reference year, not parallel majority");
  const same = result.families.find(f=>f.options.some(c=>c.cardId===55352))!;
  assert.ok(same.options.some(c=>c.cardId===16483),"1992 original in reprint artwork group");
  assert.ok(same.options.some(c=>c.cardId===16583),"unindexed parallel retained");
  await mkdir(".local/scan-v1/qa/phone-rows",{recursive:true});
  await writeFile(".local/scan-v1/qa/phone-rows/catalog-fixtures.json",JSON.stringify({
    result,search:await searchDevScanCatalog("darkhawk 11 1992"),
    years:await browseDevScanCatalog("years",{}),sets,
    subsets:await browseDevScanCatalog("subsets",{year:1992,mainSetId:84}),
  }));
  console.log("PASS real reference-vector same-art grouping, 5 groups, nonempty browse");
} finally { await pool.end(); }
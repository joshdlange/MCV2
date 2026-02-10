import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

const snRegex = /^(.*?)(SN)(\d+)$/i;

async function main() {
  console.log("[SN-NORMALIZE] Starting dry-run...");

  const snCards = await db.execute(sql`
    SELECT c.id, c.set_id, c.card_number, c.name, c.description
    FROM cards c
    WHERE c.name ~* 'SN[0-9]+$'
    ORDER BY c.set_id, c.card_number
  `);

  console.log(`[SN-NORMALIZE] Found ${snCards.rows.length} cards with SN pattern`);

  const report: any[] = [];
  let wouldUpdateName = 0;
  let wouldUpdateDesc = 0;

  for (const row of snCards.rows as any[]) {
    const match = row.name.match(snRegex);
    if (!match) continue;

    const cleanName = match[1].trim();
    const digits = match[3];
    const serialTag = `/${digits}`;

    const oldDesc = row.description || '';
    let newDesc = oldDesc;
    const nameChanged = cleanName !== row.name;

    if (!oldDesc || oldDesc.trim() === '') {
      newDesc = serialTag;
    } else if (oldDesc.includes(serialTag)) {
      newDesc = oldDesc;
    } else {
      newDesc = oldDesc + ' ' + serialTag;
    }

    const descChanged = newDesc !== oldDesc;
    if (nameChanged) wouldUpdateName++;
    if (descChanged) wouldUpdateDesc++;

    report.push({
      card_id: row.id,
      set_id: row.set_id,
      card_number: row.card_number,
      old_name: row.name,
      new_name: cleanName,
      old_description: oldDesc,
      new_description: newDesc,
      serialTag,
    });
  }

  console.log(`\n=== DRY-RUN RESULTS ===`);
  console.log(`Matched: ${report.length}`);
  console.log(`Would update name: ${wouldUpdateName}`);
  console.log(`Would update description: ${wouldUpdateDesc}`);
  
  console.log(`\nSample (first 15):`);
  for (const r of report.slice(0, 15)) {
    console.log(`  "${r.old_name}" -> "${r.new_name}" | desc: "${r.new_description}"`);
  }

  const csvHeader = (obj: any) => Object.keys(obj).join(',');
  const csvRow = (obj: any) => Object.values(obj).map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');

  if (report.length > 0) {
    const csvLines = [csvHeader(report[0]), ...report.map(csvRow)];
    fs.writeFileSync('/tmp/sn-normalize-dryrun.csv', csvLines.join('\n'), 'utf-8');
    console.log(`\nSaved /tmp/sn-normalize-dryrun.csv (${report.length} rows)`);
  }

  if (process.env.APPLY !== '1') {
    console.log(`\n--- To apply, re-run with APPLY=1 ---`);
    process.exit(0);
  }
  
  console.log(`\n=== APPLYING CHANGES ===`);
  const batch = 1000;
  let totalUpdated = 0;

  for (let i = 0; i < report.length; i += batch) {
    const batchItems = report.slice(i, i + batch);
    const batchNum = Math.floor(i / batch) + 1;

    await db.execute(sql`BEGIN`);
    try {
      for (const item of batchItems) {
        await db.execute(sql`
          UPDATE cards
          SET name = ${item.new_name}, description = ${item.new_description}
          WHERE id = ${item.card_id}
        `);
      }
      await db.execute(sql`COMMIT`);
      totalUpdated += batchItems.length;
      console.log(`Batch ${batchNum}: updated ${batchItems.length} rows (total: ${totalUpdated})`);
    } catch (batchErr) {
      await db.execute(sql`ROLLBACK`);
      console.error(`Batch ${batchNum} FAILED, rolled back:`, batchErr);
      process.exit(1);
    }
    if (i + batch < report.length) await new Promise(r => setTimeout(r, 10));
  }

  const applyRows = report.map(r => ({ ...r, status: 'updated' }));
  if (applyRows.length > 0) {
    const csvLines = [csvHeader(applyRows[0]), ...applyRows.map(csvRow)];
    fs.writeFileSync('/tmp/sn-normalize-apply-summary.csv', csvLines.join('\n'), 'utf-8');
    console.log(`Saved /tmp/sn-normalize-apply-summary.csv`);
  }

  const remainCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM cards WHERE name ~* 'SN[0-9]+$'`);
  const remaining = parseInt((remainCheck.rows[0] as any).cnt) || 0;
  console.log(`\n=== APPLY COMPLETE ===`);
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`Remaining SN cards: ${remaining}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

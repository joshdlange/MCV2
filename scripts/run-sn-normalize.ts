import { pool } from "../server/db";

const snRegex = /^(.*?)(SN)(\d+)$/i;

async function main() {
  console.log("[SN-NORMALIZE] Checking remaining SN cards...");

  const snCards = await pool.query(
    "SELECT id, set_id, card_number, name, description FROM cards WHERE name ~* 'SN[0-9]+$' ORDER BY set_id, card_number"
  );

  console.log(`[SN-NORMALIZE] Found ${snCards.rows.length} remaining cards`);

  if (snCards.rows.length === 0) {
    console.log("Nothing to do!");
    process.exit(0);
  }

  const report: any[] = [];
  for (const row of snCards.rows) {
    const match = row.name.match(snRegex);
    if (!match) continue;
    const cleanName = match[1].trim();
    const serialTag = `/${match[3]}`;
    const oldDesc = row.description || '';
    let newDesc: string;
    if (!oldDesc || oldDesc.trim() === '') {
      newDesc = serialTag;
    } else if (oldDesc.includes(serialTag)) {
      newDesc = oldDesc;
    } else {
      newDesc = oldDesc + ' ' + serialTag;
    }
    report.push({ card_id: row.id, new_name: cleanName, new_description: newDesc });
  }

  console.log(`[SN-NORMALIZE] Applying ${report.length} updates...`);

  const batchSize = 200;
  let totalUpdated = 0;

  for (let i = 0; i < report.length; i += batchSize) {
    const batch = report.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    const values: string[] = [];
    const params: any[] = [];
    for (let j = 0; j < batch.length; j++) {
      const p = j * 3;
      values.push(`($${p+1}::int, $${p+2}::text, $${p+3}::text)`);
      params.push(batch[j].card_id, batch[j].new_name, batch[j].new_description);
    }

    try {
      await pool.query(
        `UPDATE cards SET name = b.n, description = b.d FROM (VALUES ${values.join(',')}) AS b(id, n, d) WHERE cards.id = b.id`,
        params
      );
      totalUpdated += batch.length;
      if (batchNum % 20 === 0 || i + batchSize >= report.length) {
        console.log(`  Batch ${batchNum}: ${totalUpdated}/${report.length}`);
      }
    } catch (err) {
      console.error(`Batch ${batchNum} FAILED:`, err);
      process.exit(1);
    }
  }

  const remain = await pool.query("SELECT COUNT(*) as cnt FROM cards WHERE name ~* 'SN[0-9]+$'");
  console.log(`\n=== COMPLETE ===`);
  console.log(`Updated: ${totalUpdated}`);
  console.log(`Remaining SN cards: ${remain.rows[0].cnt}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

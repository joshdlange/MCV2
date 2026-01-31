import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Get normalized names for sets containing spider-man renditions
  const { rows: sets } = await pool.query(`
    SELECT id, name, lower(trim(regexp_replace(name, E'\\s+', ' ', 'g'))) as normalized
    FROM card_sets 
    WHERE lower(name) LIKE '%spider-man renditions%' AND lower(name) LIKE '%marvel universe impel%'
    AND is_active = true
    LIMIT 5
  `);
  
  console.log("DB sets matching pattern:");
  for (const s of sets) {
    console.log(`ID ${s.id}: "${s.normalized}"`);
    console.log(`  Length: ${s.normalized.length}`);
  }
  
  // Compare with CSV normalized value
  const csvNorm = "2024 upper deck marvel spider-man renditions - marvel universe impel";
  console.log(`\nCSV normalized: "${csvNorm}"`);
  console.log(`CSV length: ${csvNorm.length}`);
  
  if (sets.length > 0) {
    const dbNorm = sets[0].normalized;
    console.log(`\nDB length: ${dbNorm.length}`);
    console.log(`Match: ${dbNorm === csvNorm}`);
    
    // Find first difference
    for (let i = 0; i < Math.max(dbNorm.length, csvNorm.length); i++) {
      if (dbNorm[i] !== csvNorm[i]) {
        console.log(`First diff at position ${i}:`);
        console.log(`  DB char: "${dbNorm[i]}" (code ${dbNorm.charCodeAt(i)})`);
        console.log(`  CSV char: "${csvNorm[i]}" (code ${csvNorm.charCodeAt(i)})`);
        console.log(`  Context DB: "${dbNorm.substring(Math.max(0,i-5), i+5)}"`);
        console.log(`  Context CSV: "${csvNorm.substring(Math.max(0,i-5), i+5)}"`);
        break;
      }
    }
  }
  
  await pool.end();
}
main();

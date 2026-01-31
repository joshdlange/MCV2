import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Query DB directly for the specific set
  const { rows } = await pool.query(`
    SELECT id, name, lower(trim(regexp_replace(name, E'\\s+', ' ', 'g'))) as normalized
    FROM card_sets WHERE id = 2453
  `);
  
  console.log("DB row:");
  console.log(`  ID: ${rows[0].id}`);
  console.log(`  Name: "${rows[0].name}"`);
  console.log(`  Normalized: "${rows[0].normalized}"`);
  console.log(`  Normalized length: ${rows[0].normalized.length}`);
  
  // Build the cache the same way as the import
  const { rows: sets } = await pool.query(
    `SELECT id, lower(trim(regexp_replace(name, E'\\s+', ' ', 'g'))) as normalized_name 
     FROM card_sets WHERE is_active = true`
  );
  
  const setCache = new Map();
  for (const s of sets) {
    setCache.set(s.normalized_name, s.id);
  }
  
  // Check if the key exists
  const csvNorm = "2024 upper deck marvel spider-man renditions - marvel universe impel";
  console.log(`\nCSV normalized: "${csvNorm}" (len ${csvNorm.length})`);
  console.log(`Found in cache: ${setCache.has(csvNorm)}`);
  
  // Find similar keys
  let foundSimilar = false;
  for (const [key, id] of setCache.entries()) {
    if (key.includes('spider-man renditions') && key.includes('impel') && !key.includes('printing') && !key.includes('artist')) {
      console.log(`\nSimilar key in cache:`);
      console.log(`  Key: "${key}" (len ${key.length})`);
      console.log(`  ID: ${id}`);
      console.log(`  Matches: ${key === csvNorm}`);
      foundSimilar = true;
      break;
    }
  }
  
  if (!foundSimilar) {
    console.log("\nNo similar key found in cache!");
  }
  
  await pool.end();
}
main();

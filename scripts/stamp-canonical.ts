import { db } from '../server/db';
import { cardSets } from '../shared/schema';
import { eq, and, or, sql, inArray } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

interface CsvRow {
  setNumber: number;
  setYear: number;
  mainSetName: string;
  subSetName: string;
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function parseCSV(csvPath: string): CsvRow[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').slice(1).filter(line => line.trim());
  const rows: CsvRow[] = [];

  for (const line of lines) {
    let setNumber = 0;
    let setYear = 0;
    let mainSetName = '';
    let subSetName = '';

    if (line.includes('"')) {
      const match = line.match(/^(\d+),(\d+),"([^"]+)",(.*)$/);
      if (match) {
        setNumber = parseInt(match[1]) || 0;
        setYear = parseInt(match[2]) || 0;
        mainSetName = match[3].trim();
        subSetName = match[4].trim().replace(/"/g, '');
      } else {
        const match2 = line.match(/^(\d+),(\d+),([^,]+),(.*)$/);
        if (match2) {
          setNumber = parseInt(match2[1]) || 0;
          setYear = parseInt(match2[2]) || 0;
          mainSetName = match2[3].trim();
          subSetName = match2[4].trim();
        }
      }
    } else {
      const parts = line.split(',');
      if (parts.length >= 3) {
        setNumber = parseInt(parts[0]) || 0;
        setYear = parseInt(parts[1]) || 0;
        mainSetName = parts[2].trim();
        subSetName = parts.slice(3).join(',').trim();
      }
    }

    if (setYear > 0 && mainSetName) {
      rows.push({ setNumber, setYear, mainSetName, subSetName });
    }
  }

  return rows;
}

async function main() {
  console.log('=== STAMP CANONICAL SETS FROM CSV ===\n');

  const csvPath = path.join(process.cwd(), 'attached_assets/Marvel_Sets_&_Subsets_REDO_-_Sets_To_Sub_Sets_1769522735270.csv');
  const csvRows = parseCSV(csvPath);
  console.log(`Loaded ${csvRows.length} rows from CSV\n`);

  const existingCardSets = await db.select().from(cardSets);
  const cardSetsBySlug = new Map(existingCardSets.map(cs => [cs.slug, cs]));
  const cardSetsByYearAndName = new Map<string, typeof existingCardSets[0]>();
  for (const cs of existingCardSets) {
    const key = `${cs.year}|${cs.name.toLowerCase()}`;
    cardSetsByYearAndName.set(key, cs);
  }

  console.log(`Total card_sets in DB: ${existingCardSets.length}`);

  const csvDefinedSetIds = new Set<number>();
  let matched = 0;
  let notFound = 0;

  for (const row of csvRows) {
    let displayName: string;
    if (!row.subSetName || row.subSetName.toLowerCase() === 'base') {
      displayName = row.mainSetName;
    } else {
      displayName = `${row.mainSetName} - ${row.subSetName}`;
    }

    const slug = generateSlug(`${row.setYear}-${row.mainSetName}-${row.subSetName || 'base'}`);
    const lookupKey = `${row.setYear}|${displayName.toLowerCase()}`;

    const existingBySlug = cardSetsBySlug.get(slug);
    const existingByName = cardSetsByYearAndName.get(lookupKey);

    if (existingBySlug) {
      csvDefinedSetIds.add(existingBySlug.id);
      matched++;
    } else if (existingByName) {
      csvDefinedSetIds.add(existingByName.id);
      matched++;
    } else {
      notFound++;
      if (notFound <= 10) {
        console.log(`  NOT FOUND: ${displayName} (${row.setYear}) slug=${slug}`);
      }
    }
  }

  if (notFound > 10) {
    console.log(`  ... and ${notFound - 10} more not found`);
  }

  console.log(`\nMatching results:`);
  console.log(`  CSV rows: ${csvRows.length}`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Unique set IDs to stamp: ${csvDefinedSetIds.size}`);

  if (csvDefinedSetIds.size === 0) {
    console.log('\nNo sets to stamp. Exiting.');
    process.exit(0);
  }

  console.log('\nStamping canonical_source=csv_master and is_canonical=true...');

  const idsArray = [...csvDefinedSetIds];
  const batchSize = 500;
  let updated = 0;
  
  for (let i = 0; i < idsArray.length; i += batchSize) {
    const batch = idsArray.slice(i, i + batchSize);
    await db.update(cardSets)
      .set({ canonicalSource: 'csv_master', isCanonical: true })
      .where(inArray(cardSets.id, batch));
    updated += batch.length;
    console.log(`  Updated batch ${Math.floor(i / batchSize) + 1}: ${updated}/${idsArray.length}`);
  }

  console.log(`Updated ${idsArray.length} card_sets as canonical\n`);

  const verifyCount = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM card_sets WHERE canonical_source = 'csv_master'
  `);
  console.log(`Verification: ${verifyCount.rows[0].cnt} sets have canonical_source='csv_master'`);

  const sampleSets = await db.execute(sql`
    SELECT id, name, year, slug, canonical_source 
    FROM card_sets 
    WHERE canonical_source = 'csv_master' 
    ORDER BY year DESC, name 
    LIMIT 10
  `);
  console.log('\nSample canonical sets:');
  for (const row of sampleSets.rows) {
    console.log(`  ID ${row.id}: ${row.name} (${row.year}) - ${row.slug}`);
  }

  console.log('\n=== CANONICAL STAMP COMPLETE ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

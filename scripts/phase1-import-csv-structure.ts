import { db } from '../server/db';
import { cardSets, mainSets } from '../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
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
  console.log('=== PHASE 1: Import CSV Structure (ADD-ONLY) ===\n');

  const csvPath = path.join(process.cwd(), 'attached_assets/Marvel_Sets_&_Subsets_REDO_-_Sets_To_Sub_Sets_1769522735270.csv');
  const csvRows = parseCSV(csvPath);
  console.log(`Loaded ${csvRows.length} rows from CSV\n`);

  console.log('--- Phase 1A: Upsert main_sets ---\n');

  const uniqueMainSets = [...new Set(csvRows.map(r => r.mainSetName))];
  console.log(`Found ${uniqueMainSets.length} unique main set names in CSV`);

  const existingMainSets = await db.select().from(mainSets);
  const mainSetsByName = new Map(existingMainSets.map(m => [m.name.toLowerCase(), m]));
  const mainSetsBySlug = new Map(existingMainSets.map(m => [m.slug, m]));

  let mainSetsAdded = 0;
  let mainSetsExisted = 0;
  const mainSetNameToId = new Map<string, number>();

  for (const name of uniqueMainSets) {
    const slug = generateSlug(name);
    const existingByName = mainSetsByName.get(name.toLowerCase());
    const existingBySlug = mainSetsBySlug.get(slug);

    if (existingByName) {
      mainSetNameToId.set(name, existingByName.id);
      mainSetsExisted++;
    } else if (existingBySlug) {
      mainSetNameToId.set(name, existingBySlug.id);
      mainSetsExisted++;
    } else {
      const [inserted] = await db.insert(mainSets).values({
        name: name,
        slug: slug,
      }).returning();
      mainSetNameToId.set(name, inserted.id);
      mainSetsAdded++;
      console.log(`  Added main_set: ${name} (ID: ${inserted.id})`);
    }
  }

  console.log(`\nPhase 1A Results:`);
  console.log(`  Main sets added: ${mainSetsAdded}`);
  console.log(`  Main sets already existed: ${mainSetsExisted}`);

  console.log('\n--- Phase 1B: Upsert card_sets ---\n');

  const existingCardSets = await db.select().from(cardSets);
  const cardSetsBySlug = new Map(existingCardSets.map(cs => [cs.slug, cs]));
  const cardSetsByYearAndName = new Map<string, typeof existingCardSets[0]>();
  for (const cs of existingCardSets) {
    const key = `${cs.year}|${cs.name.toLowerCase()}`;
    cardSetsByYearAndName.set(key, cs);
  }

  let cardSetsAdded = 0;
  let cardSetsExisted = 0;
  const csvDefinedSetIds = new Set<number>();

  for (const row of csvRows) {
    const mainSetId = mainSetNameToId.get(row.mainSetName);
    if (!mainSetId) {
      console.error(`  ERROR: Could not find main_set for: ${row.mainSetName}`);
      continue;
    }

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
      cardSetsExisted++;
    } else if (existingByName) {
      csvDefinedSetIds.add(existingByName.id);
      cardSetsExisted++;
    } else {
      try {
        const [inserted] = await db.insert(cardSets).values({
          name: displayName,
          slug: slug,
          year: row.setYear,
          mainSetId: mainSetId,
          totalCards: 0,
        }).returning();
        csvDefinedSetIds.add(inserted.id);
        cardSetsAdded++;
        if (cardSetsAdded <= 20) {
          console.log(`  Added card_set: ${displayName} (ID: ${inserted.id})`);
        }
      } catch (err: any) {
        if (err.message?.includes('duplicate key')) {
          const uniqueSlug = `${slug}-${Date.now()}`;
          const [inserted] = await db.insert(cardSets).values({
            name: displayName,
            slug: uniqueSlug,
            year: row.setYear,
            mainSetId: mainSetId,
            totalCards: 0,
          }).returning();
          csvDefinedSetIds.add(inserted.id);
          cardSetsAdded++;
          if (cardSetsAdded <= 20) {
            console.log(`  Added card_set (with unique slug): ${displayName} (ID: ${inserted.id})`);
          }
        } else {
          console.error(`  ERROR inserting ${displayName}: ${err.message}`);
        }
      }
    }
  }

  if (cardSetsAdded > 20) {
    console.log(`  ... and ${cardSetsAdded - 20} more card_sets added`);
  }

  console.log(`\nPhase 1B Results:`);
  console.log(`  Card sets added: ${cardSetsAdded}`);
  console.log(`  Card sets already existed: ${cardSetsExisted}`);

  console.log('\n========================================');
  console.log('         PHASE 1 SUMMARY               ');
  console.log('========================================');
  console.log(`Main sets added:          ${mainSetsAdded}`);
  console.log(`Main sets existed:        ${mainSetsExisted}`);
  console.log(`Card sets added:          ${cardSetsAdded}`);
  console.log(`Card sets existed:        ${cardSetsExisted}`);
  console.log(`CSV-defined set IDs:      ${csvDefinedSetIds.size}`);
  console.log('========================================\n');

  const outputPath = path.join(process.cwd(), 'phase1-csv-defined-set-ids.json');
  fs.writeFileSync(outputPath, JSON.stringify([...csvDefinedSetIds], null, 2));
  console.log(`Saved CSV-defined set IDs to: ${outputPath}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

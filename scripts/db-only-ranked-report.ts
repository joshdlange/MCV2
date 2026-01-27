import { db } from '../server/db';
import { cardSets, mainSets, cards } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

interface CsvRow {
  setNumber: string;
  setYear: number;
  mainSetName: string;
  subSetName: string;
}

function normalize(str: string): string {
  return str.toLowerCase()
    .replace(/[\[\]]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) return 1.0;
  
  const wordsA = normA.split(' ');
  const wordsB = normB.split(' ');
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  
  let matches = 0;
  for (const word of setA) {
    if (setB.has(word)) matches++;
  }
  
  return matches / Math.max(setA.size, setB.size);
}

async function main() {
  console.log('=== DB-Only Sets Ranked by Card Count ===\n');
  
  const csvPath = path.join(process.cwd(), 'attached_assets/Marvel_Sets_&_Subsets_REDO_-_Sets_To_Sub_Sets_1769482558947.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1).filter(line => line.trim());
  
  const csvSets: CsvRow[] = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 3) {
      const setNumber = parts[0].trim();
      const setYear = parseInt(parts[1].trim()) || 0;
      let mainSetName = parts[2].trim();
      let subSetName = parts.slice(3).join(',').trim();
      
      if (mainSetName.startsWith('"')) {
        const fullLine = line;
        const matches = fullLine.match(/"([^"]+)"/g);
        if (matches && matches.length > 0) {
          mainSetName = matches[0].replace(/"/g, '');
        }
      }
      
      subSetName = subSetName.replace(/"/g, '').trim();
      
      csvSets.push({ setNumber, setYear, mainSetName, subSetName });
    }
  }
  
  console.log(`Loaded ${csvSets.length} rows from CSV`);
  
  const dbSetsWithCounts = await db
    .select({
      id: cardSets.id,
      name: cardSets.name,
      year: cardSets.year,
      mainSetId: cardSets.mainSetId,
      cardCount: sql<number>`count(${cards.id})`.as('card_count'),
    })
    .from(cardSets)
    .leftJoin(cards, eq(cards.setId, cardSets.id))
    .groupBy(cardSets.id, cardSets.name, cardSets.year, cardSets.mainSetId);
  
  console.log(`Found ${dbSetsWithCounts.length} sets in database`);
  
  const mainSetsData = await db.select({ id: mainSets.id, name: mainSets.name }).from(mainSets);
  const mainSetsMap = new Map(mainSetsData.map(m => [m.id, m.name]));
  
  const dbMatched = new Set<number>();
  
  for (const dbSet of dbSetsWithCounts) {
    for (const csvRow of csvSets) {
      if (dbSet.year !== csvRow.setYear) continue;
      
      const csvFullName = csvRow.subSetName 
        ? `${csvRow.mainSetName} - ${csvRow.subSetName}`
        : csvRow.mainSetName;
      
      const dbNorm = normalize(dbSet.name);
      const csvNorm = normalize(csvFullName);
      const subNorm = normalize(csvRow.subSetName || csvRow.mainSetName);
      
      if (dbNorm === csvNorm || dbNorm === subNorm) {
        dbMatched.add(dbSet.id);
        break;
      }
      
      const score = similarity(csvFullName, dbSet.name);
      if (score >= 0.5) {
        dbMatched.add(dbSet.id);
        break;
      }
    }
  }
  
  const dbOnly = dbSetsWithCounts
    .filter(dbSet => !dbMatched.has(dbSet.id))
    .sort((a, b) => Number(b.cardCount) - Number(a.cardCount));
  
  console.log(`\nDB-only sets: ${dbOnly.length}`);
  console.log(`\nTop 20 by card count:`);
  console.log('-----------------------------------');
  
  for (const set of dbOnly.slice(0, 20)) {
    const mainSetName = set.mainSetId ? mainSetsMap.get(set.mainSetId) || '' : '';
    console.log(`[ID: ${set.id}] ${set.name} (${set.year}) - ${set.cardCount} cards - Main: ${mainSetName || 'None'}`);
  }
  
  const reportPath = path.join(process.cwd(), 'db-only-ranked-by-cardcount.csv');
  const reportLines = [
    'card_sets_id,year,name,main_set_name,card_count'
  ];
  
  for (const set of dbOnly) {
    const mainSetName = set.mainSetId ? mainSetsMap.get(set.mainSetId) || '' : '';
    const safeName = set.name.replace(/"/g, '""');
    const safeMainSetName = mainSetName.replace(/"/g, '""');
    reportLines.push(`${set.id},${set.year},"${safeName}","${safeMainSetName}",${set.cardCount}`);
  }
  
  fs.writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`\n\nReport saved to: ${reportPath}`);
  console.log(`Total DB-only sets: ${dbOnly.length}`);
  
  const withCards = dbOnly.filter(s => Number(s.cardCount) > 0).length;
  const withoutCards = dbOnly.filter(s => Number(s.cardCount) === 0).length;
  console.log(`Sets with cards: ${withCards}`);
  console.log(`Sets with 0 cards: ${withoutCards}`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

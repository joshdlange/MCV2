import { db } from '../server/db';
import { cardSets, mainSets } from '../shared/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

interface CsvRow {
  setNumber: string;
  setYear: number;
  mainSetName: string;
  subSetName: string;
}

interface DbSet {
  id: number;
  name: string;
  year: number;
  slug: string;
  mainSetId: number | null;
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
  console.log('=== DRY RUN: Card Sets Comparison Report ===\n');
  console.log('Reading CSV file...');
  
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
  
  console.log(`Loaded ${csvSets.length} rows from CSV\n`);
  
  console.log('Querying database...');
  const dbSets = await db.select({
    id: cardSets.id,
    name: cardSets.name,
    year: cardSets.year,
    slug: cardSets.slug,
    mainSetId: cardSets.mainSetId,
  }).from(cardSets);
  
  console.log(`Found ${dbSets.length} sets in database\n`);
  
  const exactMatches: { csv: CsvRow; db: DbSet }[] = [];
  const dbOnly: DbSet[] = [];
  const csvOnly: CsvRow[] = [];
  const closeMatches: { csv: CsvRow; db: DbSet; score: number }[] = [];
  
  const dbMatched = new Set<number>();
  const csvMatched = new Set<number>();
  
  for (let i = 0; i < csvSets.length; i++) {
    const csvRow = csvSets[i];
    const csvFullName = csvRow.subSetName 
      ? `${csvRow.mainSetName} - ${csvRow.subSetName}`
      : csvRow.mainSetName;
    const csvNorm = normalize(csvFullName);
    
    let bestMatch: DbSet | null = null;
    let bestScore = 0;
    
    for (const dbSet of dbSets) {
      if (dbSet.year !== csvRow.setYear) continue;
      
      const dbNorm = normalize(dbSet.name);
      
      if (dbNorm === csvNorm) {
        bestMatch = dbSet;
        bestScore = 1.0;
        break;
      }
      
      const subNorm = normalize(csvRow.subSetName || csvRow.mainSetName);
      if (dbNorm === subNorm) {
        bestMatch = dbSet;
        bestScore = 1.0;
        break;
      }
      
      const score = similarity(csvFullName, dbSet.name);
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = dbSet;
      }
    }
    
    if (bestScore === 1.0 && bestMatch) {
      exactMatches.push({ csv: csvRow, db: bestMatch });
      dbMatched.add(bestMatch.id);
      csvMatched.add(i);
    } else if (bestScore >= 0.5 && bestMatch && !dbMatched.has(bestMatch.id)) {
      closeMatches.push({ csv: csvRow, db: bestMatch, score: bestScore });
      dbMatched.add(bestMatch.id);
      csvMatched.add(i);
    }
  }
  
  for (let i = 0; i < csvSets.length; i++) {
    if (!csvMatched.has(i)) {
      csvOnly.push(csvSets[i]);
    }
  }
  
  for (const dbSet of dbSets) {
    if (!dbMatched.has(dbSet.id)) {
      dbOnly.push(dbSet);
    }
  }
  
  console.log('========================================');
  console.log('           COMPARISON SUMMARY           ');
  console.log('========================================\n');
  console.log(`Total CSV entries:     ${csvSets.length}`);
  console.log(`Total DB sets:         ${dbSets.length}`);
  console.log(`Exact matches:         ${exactMatches.length}`);
  console.log(`Close matches (>=50%): ${closeMatches.length}`);
  console.log(`CSV only (not in DB):  ${csvOnly.length}`);
  console.log(`DB only (not in CSV):  ${dbOnly.length}`);
  
  console.log('\n\n========================================');
  console.log('     EXACT MATCHES (first 20)          ');
  console.log('========================================');
  for (const match of exactMatches.slice(0, 20)) {
    const csvName = match.csv.subSetName 
      ? `${match.csv.mainSetName} - ${match.csv.subSetName}`
      : match.csv.mainSetName;
    console.log(`\n[CSV] ${csvName} (${match.csv.setYear})`);
    console.log(`[DB]  ${match.db.name} (ID: ${match.db.id})`);
  }
  if (exactMatches.length > 20) {
    console.log(`\n... and ${exactMatches.length - 20} more exact matches`);
  }
  
  console.log('\n\n========================================');
  console.log('     CLOSE MATCHES (first 30)          ');
  console.log('========================================');
  for (const match of closeMatches.slice(0, 30)) {
    const csvName = match.csv.subSetName 
      ? `${match.csv.mainSetName} - ${match.csv.subSetName}`
      : match.csv.mainSetName;
    console.log(`\n[CSV] ${csvName} (${match.csv.setYear})`);
    console.log(`[DB]  ${match.db.name} (ID: ${match.db.id})`);
    console.log(`      Similarity: ${(match.score * 100).toFixed(0)}%`);
  }
  if (closeMatches.length > 30) {
    console.log(`\n... and ${closeMatches.length - 30} more close matches`);
  }
  
  console.log('\n\n========================================');
  console.log('     IN CSV BUT NOT IN DB (first 50)   ');
  console.log('========================================');
  for (const row of csvOnly.slice(0, 50)) {
    const name = row.subSetName 
      ? `${row.mainSetName} - ${row.subSetName}`
      : row.mainSetName;
    console.log(`[#${row.setNumber}] ${name} (${row.setYear})`);
  }
  if (csvOnly.length > 50) {
    console.log(`\n... and ${csvOnly.length - 50} more CSV-only entries`);
  }
  
  console.log('\n\n========================================');
  console.log('     IN DB BUT NOT IN CSV (first 50)   ');
  console.log('========================================');
  for (const dbSet of dbOnly.slice(0, 50)) {
    console.log(`[ID: ${dbSet.id}] ${dbSet.name} (${dbSet.year})`);
  }
  if (dbOnly.length > 50) {
    console.log(`\n... and ${dbOnly.length - 50} more DB-only sets`);
  }
  
  const reportPath = path.join(process.cwd(), 'dryrun-comparison-report.csv');
  const reportLines = [
    'Category,SetNumber/ID,Year,Name,MatchedWith,Similarity'
  ];
  
  for (const m of exactMatches) {
    const csvName = m.csv.subSetName 
      ? `${m.csv.mainSetName} - ${m.csv.subSetName}`
      : m.csv.mainSetName;
    reportLines.push(`EXACT_MATCH,CSV#${m.csv.setNumber},${m.csv.setYear},"${csvName.replace(/"/g, '""')}","${m.db.name.replace(/"/g, '""')} (ID:${m.db.id})",100%`);
  }
  
  for (const m of closeMatches) {
    const csvName = m.csv.subSetName 
      ? `${m.csv.mainSetName} - ${m.csv.subSetName}`
      : m.csv.mainSetName;
    reportLines.push(`CLOSE_MATCH,CSV#${m.csv.setNumber},${m.csv.setYear},"${csvName.replace(/"/g, '""')}","${m.db.name.replace(/"/g, '""')} (ID:${m.db.id})",${(m.score * 100).toFixed(0)}%`);
  }
  
  for (const row of csvOnly) {
    const name = row.subSetName 
      ? `${row.mainSetName} - ${row.subSetName}`
      : row.mainSetName;
    reportLines.push(`CSV_ONLY,CSV#${row.setNumber},${row.setYear},"${name.replace(/"/g, '""')}","",`);
  }
  
  for (const dbSet of dbOnly) {
    reportLines.push(`DB_ONLY,ID:${dbSet.id},${dbSet.year},"${dbSet.name.replace(/"/g, '""')}","",`);
  }
  
  fs.writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`\n\n========================================`);
  console.log(`CSV report saved to: ${reportPath}`);
  console.log(`========================================`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

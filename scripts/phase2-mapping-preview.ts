import { db } from '../server/db';
import { cardSets, mainSets, cards } from '../shared/schema';
import { eq, sql, inArray, notInArray } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

interface LegacySetInfo {
  id: number;
  name: string;
  year: number;
  mainSetId: number | null;
  mainSetName: string | null;
  cardCount: number;
}

interface MappingSuggestion {
  legacySetId: number;
  legacyName: string;
  legacyYear: number;
  legacyMainSetId: number | null;
  legacyMainSetName: string | null;
  legacyCardCount: number;
  suggestedCanonicalSetId: number | null;
  suggestedCanonicalName: string | null;
  suggestedConfidence: number;
  reason: string;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\[\]'"]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str: string): Set<string> {
  const normalized = normalize(str);
  const words = normalized.split(' ').filter(w => w.length > 1);
  return new Set(words);
}

function calculateTokenOverlap(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  
  let matches = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) matches++;
  }
  
  const total = Math.max(tokensA.size, tokensB.size);
  return (matches / total) * 100;
}

function extractSubsetTokens(fullName: string, mainSetName: string): Set<string> {
  const fullNorm = normalize(fullName);
  const mainNorm = normalize(mainSetName);
  
  const mainTokens = tokenize(mainSetName);
  const fullTokens = tokenize(fullName);
  
  const subsetTokens = new Set<string>();
  for (const token of fullTokens) {
    if (!mainTokens.has(token)) {
      subsetTokens.add(token);
    }
  }
  
  return subsetTokens;
}

function findBestMatch(
  legacy: LegacySetInfo,
  canonicalSets: { id: number; name: string; year: number; mainSetId: number | null }[]
): { canonicalId: number | null; canonicalName: string | null; confidence: number; reason: string } {
  const sameYearSets = canonicalSets.filter(cs => cs.year === legacy.year);
  
  if (sameYearSets.length === 0) {
    return { canonicalId: null, canonicalName: null, confidence: 0, reason: 'no_same_year_sets' };
  }
  
  let bestMatch: { id: number; name: string } | null = null;
  let bestConfidence = 0;
  let bestReason = '';
  
  const legacyNorm = normalize(legacy.name);
  
  for (const canonical of sameYearSets) {
    const canonNorm = normalize(canonical.name);
    
    if (legacyNorm === canonNorm) {
      return { 
        canonicalId: canonical.id, 
        canonicalName: canonical.name, 
        confidence: 100, 
        reason: 'exact_normalized_match' 
      };
    }
  }
  
  for (const canonical of sameYearSets) {
    const tokenOverlap = calculateTokenOverlap(legacy.name, canonical.name);
    
    if (tokenOverlap > bestConfidence) {
      bestConfidence = tokenOverlap;
      bestMatch = { id: canonical.id, name: canonical.name };
      bestReason = `token_overlap_${Math.round(tokenOverlap)}%`;
    }
  }
  
  const legacyTokens = tokenize(legacy.name);
  for (const canonical of sameYearSets) {
    const canonTokens = tokenize(canonical.name);
    
    let subsetMatches = 0;
    const commonSubsetTerms = ['gold', 'silver', 'foil', 'signature', 'sig', 'autograph', 'auto', 
                               'printing', 'plate', 'black', 'cyan', 'magenta', 'yellow',
                               'precious', 'metal', 'gems', 'refractor', 'hologram', 'prism'];
    
    for (const term of commonSubsetTerms) {
      const inLegacy = legacyTokens.has(term);
      const inCanon = canonTokens.has(term);
      if (inLegacy && inCanon) subsetMatches++;
      else if (inLegacy !== inCanon) subsetMatches -= 0.5;
    }
    
    const baseTokenOverlap = calculateTokenOverlap(legacy.name, canonical.name);
    const adjustedScore = baseTokenOverlap + (subsetMatches * 5);
    
    if (adjustedScore > bestConfidence) {
      bestConfidence = Math.min(adjustedScore, 99);
      bestMatch = { id: canonical.id, name: canonical.name };
      bestReason = `subset_term_match_${Math.round(adjustedScore)}%`;
    }
  }
  
  if (legacy.mainSetId) {
    for (const canonical of sameYearSets) {
      if (canonical.mainSetId === legacy.mainSetId) {
        const tokenOverlap = calculateTokenOverlap(legacy.name, canonical.name);
        const adjustedScore = tokenOverlap + 15;
        
        if (adjustedScore > bestConfidence) {
          bestConfidence = Math.min(adjustedScore, 99);
          bestMatch = { id: canonical.id, name: canonical.name };
          bestReason = `same_main_set_${Math.round(adjustedScore)}%`;
        }
      }
    }
  }
  
  if (bestMatch) {
    return {
      canonicalId: bestMatch.id,
      canonicalName: bestMatch.name,
      confidence: Math.round(bestConfidence),
      reason: bestReason,
    };
  }
  
  return { canonicalId: null, canonicalName: null, confidence: 0, reason: 'no_match_found' };
}

async function main() {
  console.log('=== PHASE 2: Mapping Preview Report (READ-ONLY) ===\n');
  
  const csvDefinedIdsPath = path.join(process.cwd(), 'phase1-csv-defined-set-ids.json');
  if (!fs.existsSync(csvDefinedIdsPath)) {
    console.error('ERROR: phase1-csv-defined-set-ids.json not found. Run Phase 1 first.');
    process.exit(1);
  }
  
  const csvDefinedIds: number[] = JSON.parse(fs.readFileSync(csvDefinedIdsPath, 'utf-8'));
  console.log(`Loaded ${csvDefinedIds.length} CSV-defined set IDs`);
  
  console.log('\nQuerying legacy sets (not in CSV-defined list)...');
  
  const allCardSets = await db
    .select({
      id: cardSets.id,
      name: cardSets.name,
      year: cardSets.year,
      mainSetId: cardSets.mainSetId,
    })
    .from(cardSets);
  
  const legacySetIds = allCardSets
    .filter(cs => !csvDefinedIds.includes(cs.id))
    .map(cs => cs.id);
  
  console.log(`Found ${legacySetIds.length} legacy sets (not CSV-defined)`);
  
  const mainSetsData = await db.select({ id: mainSets.id, name: mainSets.name }).from(mainSets);
  const mainSetsMap = new Map(mainSetsData.map(m => [m.id, m.name]));
  
  const cardCountsResult = await db
    .select({
      setId: cards.setId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(cards)
    .groupBy(cards.setId);
  
  const cardCountsMap = new Map(cardCountsResult.map(r => [r.setId, Number(r.count)]));
  
  const legacySets: LegacySetInfo[] = allCardSets
    .filter(cs => legacySetIds.includes(cs.id))
    .map(cs => ({
      id: cs.id,
      name: cs.name,
      year: cs.year,
      mainSetId: cs.mainSetId,
      mainSetName: cs.mainSetId ? mainSetsMap.get(cs.mainSetId) || null : null,
      cardCount: cardCountsMap.get(cs.id) || 0,
    }));
  
  console.log(`\nLegacy sets with cards: ${legacySets.filter(s => s.cardCount > 0).length}`);
  console.log(`Legacy sets without cards: ${legacySets.filter(s => s.cardCount === 0).length}`);
  
  const canonicalSets = allCardSets
    .filter(cs => csvDefinedIds.includes(cs.id))
    .map(cs => ({
      id: cs.id,
      name: cs.name,
      year: cs.year,
      mainSetId: cs.mainSetId,
    }));
  
  console.log(`\nGenerating mapping suggestions...`);
  
  const highConfidenceMappings: MappingSuggestion[] = [];
  const needsReviewMappings: MappingSuggestion[] = [];
  
  for (const legacy of legacySets) {
    const match = findBestMatch(legacy, canonicalSets);
    
    const suggestion: MappingSuggestion = {
      legacySetId: legacy.id,
      legacyName: legacy.name,
      legacyYear: legacy.year,
      legacyMainSetId: legacy.mainSetId,
      legacyMainSetName: legacy.mainSetName,
      legacyCardCount: legacy.cardCount,
      suggestedCanonicalSetId: match.canonicalId,
      suggestedCanonicalName: match.canonicalName,
      suggestedConfidence: match.confidence,
      reason: match.reason,
    };
    
    if (match.confidence >= 80) {
      highConfidenceMappings.push(suggestion);
    } else {
      needsReviewMappings.push(suggestion);
    }
  }
  
  highConfidenceMappings.sort((a, b) => b.legacyCardCount - a.legacyCardCount);
  needsReviewMappings.sort((a, b) => b.legacyCardCount - a.legacyCardCount);
  
  const highConfPath = path.join(process.cwd(), 'mapping-preview-high-confidence.csv');
  const needsReviewPath = path.join(process.cwd(), 'mapping-preview-needs-review.csv');
  
  const csvHeader = 'legacy_set_id,legacy_name,legacy_year,legacy_main_set_id,legacy_main_set_name,legacy_card_count,suggested_canonical_set_id,suggested_canonical_name,suggested_confidence,reason';
  
  function toCSVLine(m: MappingSuggestion): string {
    const safeLegacyName = `"${m.legacyName.replace(/"/g, '""')}"`;
    const safeMainSetName = m.legacyMainSetName ? `"${m.legacyMainSetName.replace(/"/g, '""')}"` : '';
    const safeCanonName = m.suggestedCanonicalName ? `"${m.suggestedCanonicalName.replace(/"/g, '""')}"` : '';
    return `${m.legacySetId},${safeLegacyName},${m.legacyYear},${m.legacyMainSetId || ''},${safeMainSetName},${m.legacyCardCount},${m.suggestedCanonicalSetId || ''},${safeCanonName},${m.suggestedConfidence},${m.reason}`;
  }
  
  const highConfLines = [csvHeader, ...highConfidenceMappings.map(toCSVLine)];
  fs.writeFileSync(highConfPath, highConfLines.join('\n'));
  
  const needsReviewLines = [csvHeader, ...needsReviewMappings.map(toCSVLine)];
  fs.writeFileSync(needsReviewPath, needsReviewLines.join('\n'));
  
  console.log('\n========================================');
  console.log('         PHASE 2 SUMMARY               ');
  console.log('========================================');
  console.log(`Total legacy sets:           ${legacySets.length}`);
  console.log(`High-confidence (>=80%):     ${highConfidenceMappings.length}`);
  console.log(`Needs review (<80%):         ${needsReviewMappings.length}`);
  console.log(`\nHigh-confidence file: ${highConfPath}`);
  console.log(`Needs-review file:    ${needsReviewPath}`);
  
  console.log('\n--- Top 20 Legacy Sets by Card Count (Needs Review) ---');
  for (const m of needsReviewMappings.slice(0, 20)) {
    console.log(`[ID: ${m.legacySetId}] ${m.legacyName} (${m.legacyYear}) - ${m.legacyCardCount} cards`);
    if (m.suggestedCanonicalName) {
      console.log(`  → Suggested: ${m.suggestedCanonicalName} (${m.suggestedConfidence}%)`);
    } else {
      console.log(`  → No match found`);
    }
  }
  
  const totalCardsInHighConf = highConfidenceMappings.reduce((sum, m) => sum + m.legacyCardCount, 0);
  const totalCardsInNeedsReview = needsReviewMappings.reduce((sum, m) => sum + m.legacyCardCount, 0);
  
  console.log('\n--- Card Impact Summary ---');
  console.log(`Cards in high-confidence sets:  ${totalCardsInHighConf.toLocaleString()}`);
  console.log(`Cards in needs-review sets:     ${totalCardsInNeedsReview.toLocaleString()}`);
  
  console.log('\n========================================');
  console.log('Confidence Rules Used:');
  console.log('- 100%: Exact normalized name match (same year)');
  console.log('- 80-99%: High token overlap + subset term matches');
  console.log('- 80-99%: Same main_set_id + token overlap bonus');
  console.log('- <80%: Low token overlap or no matching year');
  console.log('========================================\n');
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

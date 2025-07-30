#!/usr/bin/env npx tsx

/**
 * CRITICAL DATA INTEGRITY CLEANUP
 * 
 * This script fixes the catastrophic data integrity issue where:
 * - FM cards (Marvel Flair) were wrongly assigned to SkyBox Masterpieces sets
 * - LM cards were also wrongly assigned
 * - This causes all image imports to fail because we're searching for impossible combinations
 * 
 * The script will:
 * 1. Identify all misplaced FM/LM cards in wrong sets
 * 2. Find or create appropriate Flair sets for these cards
 * 3. Move cards to correct sets
 * 4. Remove duplicate cards created by faulty import
 * 5. Generate comprehensive report
 */

import { db } from '../server/db';
import { cards, cardSets } from '../shared/schema';
import { eq, sql, and, or } from 'drizzle-orm';

interface MisplacedCard {
  id: number;
  name: string;
  cardNumber: string;
  setId: number;
  setName: string;
  shouldBeInSet?: string;
}

interface CleanupResult {
  misplacedCards: number;
  duplicatesRemoved: number;
  cardsRelocated: number;
  setsCreated: number;
  errors: string[];
}

/**
 * Find all misplaced FM/LM cards in wrong sets
 */
async function findMisplacedCards(): Promise<MisplacedCard[]> {
  console.log('🔍 Finding misplaced FM/LM cards...');
  
  const misplacedCards = await db.execute(sql`
    SELECT 
      c.id,
      c.name,
      c.card_number,
      c.set_id,
      cs.name as set_name
    FROM cards c
    JOIN card_sets cs ON c.set_id = cs.id
    WHERE 
      (c.card_number LIKE 'FM-%' OR c.card_number LIKE 'LM-%')
      AND cs.name NOT LIKE '%flair%'
      AND cs.name NOT LIKE '%Flair%'
    ORDER BY c.card_number, c.name
  `);
  
  console.log(`📊 Found ${misplacedCards.rows.length} misplaced cards`);
  
  return misplacedCards.rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    cardNumber: String(row.card_number),
    setId: Number(row.set_id),
    setName: String(row.set_name)
  }));
}

/**
 * Find existing Flair sets that could house these cards
 */
async function findFlairSets(): Promise<Map<string, number>> {
  console.log('🔍 Finding existing Flair sets...');
  
  const flairSets = await db.execute(sql`
    SELECT id, name
    FROM card_sets
    WHERE 
      name LIKE '%flair%' 
      OR name LIKE '%Flair%'
    ORDER BY name
  `);
  
  const flairSetMap = new Map<string, number>();
  
  flairSets.rows.forEach(row => {
    const name = String(row.name).toLowerCase();
    const id = Number(row.id);
    flairSetMap.set(name, id);
  });
  
  console.log(`📊 Found ${flairSetMap.size} existing Flair sets`);
  
  return flairSetMap;
}

/**
 * Determine the correct Flair set for a card based on its number
 */
function determineCorrectFlairSet(cardNumber: string): string {
  // FM cards are typically from Marvel Flair sets
  if (cardNumber.startsWith('FM-')) {
    return 'marvel 1995 flair'; // Most common Flair set
  }
  
  // LM cards might be from different Flair variants
  if (cardNumber.startsWith('LM-')) {
    return 'marvel 1994 flair'; // Earlier Flair set
  }
  
  return 'marvel 1995 flair'; // Default to most common
}

/**
 * Create a Flair set if it doesn't exist
 */
async function createFlairSetIfNeeded(setName: string, flairSets: Map<string, number>): Promise<number> {
  const normalizedName = setName.toLowerCase();
  
  if (flairSets.has(normalizedName)) {
    return flairSets.get(normalizedName)!;
  }
  
  console.log(`🆕 Creating missing Flair set: "${setName}"`);
  
  // Create the set
  const [newSet] = await db.insert(cardSets).values({
    name: setName,
    slug: setName.toLowerCase().replace(/\s+/g, '-'),
    mainSetId: 1, // Assuming Marvel main set
    description: `Auto-created Flair set for FM/LM cards`,
    year: setName.includes('1994') ? 1994 : 1995
  }).returning();
  
  flairSets.set(normalizedName, newSet.id);
  
  return newSet.id;
}

/**
 * Remove duplicate cards (same name and card number in same set)
 */
async function removeDuplicateCards(): Promise<number> {
  console.log('🗑️ Removing duplicate cards...');
  
  // Find duplicates (same set_id, name, and card_number)
  const duplicates = await db.execute(sql`
    SELECT 
      c1.id,
      c1.name,
      c1.card_number,
      c1.set_id,
      cs.name as set_name
    FROM cards c1
    JOIN cards c2 ON (
      c1.set_id = c2.set_id 
      AND c1.name = c2.name 
      AND c1.card_number = c2.card_number 
      AND c1.id > c2.id
    )
    JOIN card_sets cs ON c1.set_id = cs.id
    ORDER BY c1.id
  `);
  
  console.log(`📊 Found ${duplicates.rows.length} duplicate cards to remove`);
  
  let removedCount = 0;
  
  for (const duplicate of duplicates.rows) {
    const cardId = Number(duplicate.id);
    console.log(`🗑️ Removing duplicate: Card ${cardId} - "${duplicate.name}" #${duplicate.card_number} from "${duplicate.set_name}"`);
    
    await db.delete(cards).where(eq(cards.id, cardId));
    removedCount++;
  }
  
  return removedCount;
}

/**
 * Move misplaced cards to correct Flair sets
 */
async function relocateMisplacedCards(misplacedCards: MisplacedCard[], flairSets: Map<string, number>): Promise<{ relocated: number; setsCreated: number; errors: string[] }> {
  console.log('🚚 Relocating misplaced cards to correct Flair sets...');
  
  let relocated = 0;
  let setsCreated = 0;
  const errors: string[] = [];
  const initialFlairSetCount = flairSets.size;
  
  for (const card of misplacedCards) {
    try {
      const correctSetName = determineCorrectFlairSet(card.cardNumber);
      const correctSetId = await createFlairSetIfNeeded(correctSetName, flairSets);
      
      // Check if card already exists in correct set
      const existingCard = await db.select()
        .from(cards)
        .where(and(
          eq(cards.setId, correctSetId),
          eq(cards.name, card.name),
          eq(cards.cardNumber, card.cardNumber)
        ))
        .limit(1);
      
      if (existingCard.length > 0) {
        console.log(`🗑️ Removing duplicate: Card ${card.id} already exists in correct set`);
        await db.delete(cards).where(eq(cards.id, card.id));
      } else {
        console.log(`🚚 Moving Card ${card.id}: "${card.name}" #${card.cardNumber} from "${card.setName}" to "${correctSetName}"`);
        await db.update(cards)
          .set({ setId: correctSetId })
          .where(eq(cards.id, card.id));
        relocated++;
      }
      
    } catch (error) {
      const errorMsg = `Failed to relocate card ${card.id}: ${error}`;
      errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
    }
  }
  
  setsCreated = flairSets.size - initialFlairSetCount;
  
  return { relocated, setsCreated, errors };
}

/**
 * Generate final report
 */
async function generateReport(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL DATA INTEGRITY REPORT');
  console.log('='.repeat(60));
  
  // Count cards by set type
  const skyboxFMCards = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM cards c
    JOIN card_sets cs ON c.set_id = cs.id
    WHERE (c.card_number LIKE 'FM-%' OR c.card_number LIKE 'LM-%')
      AND cs.name LIKE '%SkyBox%'
  `);
  
  const flairFMCards = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM cards c
    JOIN card_sets cs ON c.set_id = cs.id
    WHERE (c.card_number LIKE 'FM-%' OR c.card_number LIKE 'LM-%')
      AND (cs.name LIKE '%flair%' OR cs.name LIKE '%Flair%')
  `);
  
  const totalFMCards = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM cards c
    WHERE c.card_number LIKE 'FM-%' OR c.card_number LIKE 'LM-%'
  `);
  
  console.log(`FM/LM cards still in SkyBox sets: ${skyboxFMCards.rows[0].count}`);
  console.log(`FM/LM cards correctly in Flair sets: ${flairFMCards.rows[0].count}`);
  console.log(`Total FM/LM cards: ${totalFMCards.rows[0].count}`);
  
  if (Number(skyboxFMCards.rows[0].count) === 0) {
    console.log('✅ SUCCESS: All FM/LM cards have been moved to appropriate Flair sets!');
    console.log('💡 Image search should now work correctly.');
  } else {
    console.log('⚠️ WARNING: Some FM/LM cards are still in wrong sets!');
  }
}

/**
 * Main cleanup function
 */
async function main(): Promise<CleanupResult> {
  console.log('🚨 CRITICAL DATA INTEGRITY CLEANUP STARTING');
  console.log('============================================');
  
  const result: CleanupResult = {
    misplacedCards: 0,
    duplicatesRemoved: 0,
    cardsRelocated: 0,
    setsCreated: 0,
    errors: []
  };
  
  try {
    // Step 1: Find all misplaced cards
    const misplacedCards = await findMisplacedCards();
    result.misplacedCards = misplacedCards.length;
    
    if (misplacedCards.length === 0) {
      console.log('✅ No misplaced cards found! Data integrity is good.');
      return result;
    }
    
    // Show preview of misplaced cards
    console.log('\n📋 Preview of misplaced cards:');
    misplacedCards.slice(0, 10).forEach((card, i) => {
      console.log(`${i + 1}. "${card.name}" #${card.cardNumber} in "${card.setName}" (should be in Flair)`);
    });
    if (misplacedCards.length > 10) {
      console.log(`... and ${misplacedCards.length - 10} more cards\n`);
    }
    
    // Step 2: Remove duplicates first
    result.duplicatesRemoved = await removeDuplicateCards();
    
    // Step 3: Find existing Flair sets
    const flairSets = await findFlairSets();
    
    // Step 4: Relocate misplaced cards
    const relocationResult = await relocateMisplacedCards(misplacedCards, flairSets);
    result.cardsRelocated = relocationResult.relocated;
    result.setsCreated = relocationResult.setsCreated;
    result.errors = relocationResult.errors;
    
    // Step 5: Generate final report
    await generateReport();
    
    console.log('\n🎉 Data integrity cleanup completed!');
    console.log(`📊 Summary:`);
    console.log(`  - Misplaced cards found: ${result.misplacedCards}`);
    console.log(`  - Duplicates removed: ${result.duplicatesRemoved}`);
    console.log(`  - Cards relocated: ${result.cardsRelocated}`);
    console.log(`  - New sets created: ${result.setsCreated}`);
    console.log(`  - Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      result.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    return result;
    
  } catch (error) {
    console.error('💥 CRITICAL ERROR during data integrity cleanup:', error);
    throw error;
  }
}

// Run if this file is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}

export { main as fixCriticalDataIntegrity };
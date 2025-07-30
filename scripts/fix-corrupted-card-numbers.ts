#!/usr/bin/env npx tsx

/**
 * CRITICAL DATA CORRUPTION FIX
 * 
 * This script fixes the 107 corrupted card numbers in the database.
 * 
 * Root cause: generateSlug() function was incorrectly applied to card numbers,
 * causing "FM-40" to become "fm40", then concatenated with card names to create
 * corrupted entries like "antmanfm40" instead of proper "FM-40".
 * 
 * This script:
 * 1. Identifies all corrupted card numbers
 * 2. Attempts to extract the proper card number from the corruption
 * 3. Updates the database with correct card numbers
 * 4. Reports all changes made
 */

import { db } from '../server/db';
import { cards } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

interface CorruptedCard {
  id: number;
  name: string;
  cardNumber: string;
  setId: number;
}

interface FixResult {
  cardId: number;
  originalName: string;
  originalCardNumber: string;
  fixedCardNumber: string;
  fixedName?: string;
  success: boolean;
  error?: string;
}

/**
 * Extract proper card number from corrupted data
 */
function extractProperCardNumber(cardName: string, corruptedCardNumber: string): { cardNumber: string; cleanName: string } {
  // Common corruption patterns:
  // 1. "antmanfm40" -> card: "Ant-Man", number: "FM-40" 
  // 2. "shangchifm" -> card: "Shang-Chi", number: "FM-?"
  // 3. "speedfm28" -> card: "Speed", number: "FM-28"
  
  console.log(`🔍 Analyzing: name="${cardName}", corrupted="${corruptedCardNumber}"`);
  
  // Pattern 1: Extract FM/LM/etc prefixes with numbers
  const fmMatch = corruptedCardNumber.match(/([a-z]+)(fm|lm|cg|pp|aw|in|mx|mh|vs|up)(\d+)?/i);
  if (fmMatch) {
    const [, namePart, prefix, number] = fmMatch;
    const properPrefix = prefix.toUpperCase();
    const properNumber = number || '';
    const reconstructedCardNumber = properNumber ? `${properPrefix}-${properNumber}` : properPrefix;
    
    // Try to clean the card name if it contains the prefix
    let cleanName = cardName;
    const nameWithoutPrefix = cardName.replace(new RegExp(`\\s*#?${properPrefix}-?${properNumber}\\s*$`, 'i'), '').trim();
    if (nameWithoutPrefix && nameWithoutPrefix !== cardName) {
      cleanName = nameWithoutPrefix;
    }
    
    console.log(`✅ FM/LM pattern: "${reconstructedCardNumber}", clean name: "${cleanName}"`);
    return { cardNumber: reconstructedCardNumber, cleanName };
  }
  
  // Pattern 2: Extract numeric patterns (like "28" from "speedfm28")
  const numericMatch = corruptedCardNumber.match(/[a-z]+(\d+)$/);
  if (numericMatch) {
    const number = numericMatch[1];
    console.log(`✅ Numeric pattern: "${number}"`);
    return { cardNumber: number, cleanName: cardName };
  }
  
  // Pattern 3: Extract generic patterns
  const genericMatch = corruptedCardNumber.match(/([a-z]+)([a-z]{2,})(\d*)/);
  if (genericMatch) {
    const [, , suffix, number] = genericMatch;
    if (suffix && suffix.length === 2) {
      const properSuffix = suffix.toUpperCase();
      const properNumber = number || '';
      const reconstructedCardNumber = properNumber ? `${properSuffix}-${properNumber}` : properSuffix;
      console.log(`✅ Generic pattern: "${reconstructedCardNumber}"`);
      return { cardNumber: reconstructedCardNumber, cleanName: cardName };
    }
  }
  
  console.log(`❌ No pattern matched for "${corruptedCardNumber}"`);
  return { cardNumber: corruptedCardNumber, cleanName: cardName };
}

/**
 * Find all corrupted card numbers
 */
async function findCorruptedCards(): Promise<CorruptedCard[]> {
  console.log('🔍 Searching for corrupted card numbers...');
  
  // Find cards with corrupted patterns:
  // 1. Unusually long card numbers (> 10 chars)
  // 2. Card numbers containing character sequences that look like corrupted slugs
  // 3. Card numbers with lowercase mixed with uppercase that don't follow standard patterns
  
  const corruptedCards = await db.execute(sql`
    SELECT id, name, card_number, set_id 
    FROM cards 
    WHERE 
      LENGTH(card_number) > 15 
      OR (card_number LIKE '%fm%' AND card_number NOT LIKE 'FM-%')
      OR (card_number LIKE '%lm%' AND card_number NOT LIKE 'LM-%')
      OR (card_number LIKE '%antman%')
      OR (card_number LIKE '%shangchi%')
      OR (card_number LIKE '%nova%')
      OR (card_number LIKE '%bishop%')
      OR (card_number LIKE '%iceman%')
      OR (card_number LIKE '%speed%')
      OR (card_number LIKE '%goliath%')
      OR (card_number LIKE '%husk%')
      OR (card_number LIKE '%namor%')
      OR (card_number LIKE '%medusa%')
      OR (card_number LIKE '%loki%')
      OR (card_number LIKE '%shehulk%')
      OR (card_number LIKE '%toad%')
      OR (card_number LIKE '%falcon%')
      OR (card_number LIKE '%hulk%')
      OR (card_number LIKE '%gamora%')
      OR (card_number LIKE '%spectrum%')
      OR (card_number LIKE '%ironfist%')
      OR (card_number LIKE '%valkyrie%')
    ORDER BY id
  `);
  
  console.log(`📊 Found ${corruptedCards.rows.length} potentially corrupted cards`);
  
  return corruptedCards.rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    cardNumber: String(row.card_number),
    setId: Number(row.set_id)
  }));
}

/**
 * Fix a single corrupted card
 */
async function fixCard(card: CorruptedCard): Promise<FixResult> {
  try {
    console.log(`\n🔧 Fixing card ${card.id}: "${card.name}" #${card.cardNumber}`);
    
    const { cardNumber: fixedCardNumber, cleanName } = extractProperCardNumber(card.name, card.cardNumber);
    
    if (fixedCardNumber === card.cardNumber && cleanName === card.name) {
      console.log(`⚠️ No fix needed for card ${card.id}`);
      return {
        cardId: card.id,
        originalName: card.name,
        originalCardNumber: card.cardNumber,
        fixedCardNumber: card.cardNumber,
        success: false,
        error: 'No corruption detected'
      };
    }
    
    // Update the card
    const updates: any = { cardNumber: fixedCardNumber };
    if (cleanName !== card.name) {
      updates.name = cleanName;
    }
    
    await db.update(cards)
      .set(updates)
      .where(eq(cards.id, card.id));
    
    console.log(`✅ Fixed card ${card.id}: "${cleanName}" #${fixedCardNumber}`);
    
    return {
      cardId: card.id,
      originalName: card.name,
      originalCardNumber: card.cardNumber,
      fixedCardNumber,
      fixedName: cleanName !== card.name ? cleanName : undefined,
      success: true
    };
    
  } catch (error) {
    console.error(`❌ Error fixing card ${card.id}:`, error);
    return {
      cardId: card.id,
      originalName: card.name,
      originalCardNumber: card.cardNumber,
      fixedCardNumber: card.cardNumber,
      success: false,
      error: String(error)
    };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚨 CRITICAL DATA CORRUPTION FIX STARTING');
  console.log('=========================================');
  
  try {
    // Find all corrupted cards
    const corruptedCards = await findCorruptedCards();
    
    if (corruptedCards.length === 0) {
      console.log('✅ No corrupted cards found! Database is clean.');
      return;
    }
    
    console.log(`\n📋 Processing ${corruptedCards.length} corrupted cards:\n`);
    
    // Show preview of first 5 corrupted cards
    corruptedCards.slice(0, 5).forEach((card, i) => {
      console.log(`${i + 1}. Card ${card.id}: "${card.name}" #${card.cardNumber}`);
    });
    
    if (corruptedCards.length > 5) {
      console.log(`... and ${corruptedCards.length - 5} more cards\n`);
    }
    
    // Process all corrupted cards
    const results: FixResult[] = [];
    let successCount = 0;
    let failureCount = 0;
    
    for (const card of corruptedCards) {
      const result = await fixCard(card);
      results.push(result);
      
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Generate report
    console.log('\n' + '='.repeat(50));
    console.log('📊 DATA CORRUPTION FIX COMPLETE');
    console.log('='.repeat(50));
    console.log(`Total cards processed: ${corruptedCards.length}`);
    console.log(`✅ Successfully fixed: ${successCount}`);
    console.log(`❌ Failed to fix: ${failureCount}`);
    
    if (successCount > 0) {
      console.log('\n✅ SUCCESSFULLY FIXED CARDS:');
      console.log('-'.repeat(40));
      results.filter(r => r.success).forEach(result => {
        console.log(`Card ${result.cardId}: "${result.originalCardNumber}" → "${result.fixedCardNumber}"`);
        if (result.fixedName) {
          console.log(`  Name: "${result.originalName}" → "${result.fixedName}"`);
        }
      });
    }
    
    if (failureCount > 0) {
      console.log('\n❌ FAILED FIXES:');
      console.log('-'.repeat(20));
      results.filter(r => !r.success).forEach(result => {
        console.log(`Card ${result.cardId}: ${result.error}`);
      });
    }
    
    console.log('\n🎉 Data corruption fix completed!');
    console.log('💡 COMC search should now work correctly with proper card numbers.');
    
  } catch (error) {
    console.error('💥 CRITICAL ERROR during corruption fix:', error);
    throw error;
  }
}

// Run if this file is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}

export { main as fixCorruptedCardNumbers };
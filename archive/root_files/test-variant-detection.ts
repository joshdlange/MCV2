#!/usr/bin/env tsx
import { db } from './server/db';
import { cardSets, cards } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Test variant detection logic
async function testVariantDetection() {
  console.log('🧪 Testing variant detection logic...\n');

  // Test cases for variant detection
  const testCases = [
    { name: 'marvel 2025 topps finest x men \'97 X-Fractor SP', expected: 'marvel 2025 topps finest x men \'97 X-Fractor' },
    { name: 'marvel 2025 topps finest x men \'97 Refractor SP', expected: 'marvel 2025 topps finest x men \'97 Refractor' },
    { name: 'marvel 2025 topps finest x men \'97 SuperFractor SP', expected: 'marvel 2025 topps finest x men \'97 SuperFractor' },
    { name: 'marvel 2025 topps finest x men \'97', expected: null }, // Base set, not variant
  ];

  for (const testCase of testCases) {
    console.log(`Testing: "${testCase.name}"`);
    
    const variantInfo = await findBaseSetForVariant(testCase.name);
    
    if (testCase.expected === null) {
      console.log(`  ✓ Correctly identified as base set (not variant)`);
    } else if (variantInfo.isVariant && variantInfo.baseSet?.name === testCase.expected) {
      console.log(`  ✓ Correctly detected variant → Base set: "${variantInfo.baseSet.name}"`);
      console.log(`  ✓ Variant type: ${variantInfo.variantType}`);
    } else {
      console.log(`  ❌ Failed detection. Expected: "${testCase.expected}", Got: ${variantInfo.baseSet?.name || 'null'}`);
    }
    console.log('');
  }

  // Test actual database integration
  console.log('🔍 Testing database integration...\n');
  
  // Check if X-Fractor base set exists
  const xFractorBase = await db.select().from(cardSets).where(eq(cardSets.name, 'marvel 2025 topps finest x men \'97 X-Fractor'));
  
  if (xFractorBase.length > 0) {
    console.log(`✅ Found X-Fractor base set (ID: ${xFractorBase[0].id})`);
    
    // Check cards in that set
    const xFractorCards = await db.select().from(cards).where(eq(cards.setId, xFractorBase[0].id));
    console.log(`📋 X-Fractor set has ${xFractorCards.length} cards`);
    
    // Check for variant cards
    const variantCards = xFractorCards.filter(card => card.variation);
    console.log(`🎯 Found ${variantCards.length} variant cards`);
    
    if (variantCards.length > 0) {
      console.log('   Variant cards:');
      variantCards.forEach(card => {
        console.log(`   - ${card.name} #${card.cardNumber} (${card.variation})`);
      });
    }
  } else {
    console.log('❌ X-Fractor base set not found');
  }
}

// Variant detection function (copied from import script)
async function findBaseSetForVariant(setName: string): Promise<{ isVariant: boolean; baseSet: any | null; variantType: string | null }> {
  const variantPatterns = [
    { pattern: /\s+SP$/, type: 'Short Print' },
    { pattern: /\s+Refractor\s+SP$/, type: 'Refractor Short Print' },
    { pattern: /\s+SuperFractor\s+SP$/, type: 'SuperFractor Short Print' },
    { pattern: /\s+Gold\s+Refractor\s+SP$/, type: 'Gold Refractor Short Print' },
    { pattern: /\s+Red\s+Refractor\s+SP$/, type: 'Red Refractor Short Print' },
    { pattern: /\s+Orange\s+Refractor\s+SP$/, type: 'Orange Refractor Short Print' },
    { pattern: /\s+Laser\s+Refractor\s+SP$/, type: 'Laser Refractor Short Print' },
    { pattern: /\s+X-Fractor\s+SP$/, type: 'X-Fractor Short Print' },
    { pattern: /\s+Protector\s+Refractor\s+SP$/, type: 'Protector Refractor Short Print' },
  ];

  for (const { pattern, type } of variantPatterns) {
    if (pattern.test(setName)) {
      const baseSetName = setName.replace(pattern, '').trim();
      const baseSet = await db.select().from(cardSets).where(eq(cardSets.name, baseSetName));
      
      if (baseSet.length > 0) {
        return {
          isVariant: true,
          baseSet: baseSet[0],
          variantType: type
        };
      }
    }
  }

  return {
    isVariant: false,
    baseSet: null,
    variantType: null
  };
}

// Run the test
testVariantDetection().catch(console.error);
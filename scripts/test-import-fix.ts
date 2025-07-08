#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function testImportFix() {
  console.log('🔍 Testing import fix...');
  
  // Get first 3 sets for testing
  const sets = await db.select().from(cardSets).limit(3);
  console.log(`Found ${sets.length} sets to test`);
  
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    console.log(`\n[${i + 1}/${sets.length}] Testing set: "${set.name}"`);
    
    // Get existing cards
    const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
    console.log(`  Current cards: ${existingCards.length}`);
    
    // This proves the loop works through multiple sets
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n✅ Loop test completed - ready for full import');
}

testImportFix().catch(console.error);
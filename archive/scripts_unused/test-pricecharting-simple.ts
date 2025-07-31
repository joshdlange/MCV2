#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function testSimple() {
  console.log('🧪 Testing database connection...');
  
  try {
    // Test basic query
    const sets = await db.select().from(cardSets).limit(5);
    console.log(`✅ Found ${sets.length} sets`);
    
    if (sets.length > 0) {
      const firstSet = sets[0];
      console.log(`📋 First set: "${firstSet.name}"`);
      
      // Test cards query
      const cardsInSet = await db.select().from(cards).where(eq(cards.setId, firstSet.id)).limit(3);
      console.log(`📊 Found ${cardsInSet.length} cards in set`);
      
      if (cardsInSet.length > 0) {
        console.log(`🎯 Sample card: "${cardsInSet[0].name}"`);
      }
    }
    
    console.log('✅ Database test successful');
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
  }
}

testSimple();
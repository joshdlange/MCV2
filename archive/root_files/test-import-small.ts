#!/usr/bin/env tsx

import { db } from './server/db';
import { cardSets } from './shared/schema';
import { eq } from 'drizzle-orm';

async function testSmallImport() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    return;
  }

  // Test with just the first 3 sets
  const allSets = await db.select().from(cardSets).limit(3);
  console.log(`Testing with ${allSets.length} sets:`);
  
  for (const set of allSets) {
    console.log(`🔍 Testing set: "${set.name}"`);
    
    const searchUrl = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(set.name)}`;
    
    try {
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.status === 'success') {
        console.log(`  ✅ Found ${data.products.length} products`);
        
        // Show first few products
        data.products.slice(0, 3).forEach((product: any, index: number) => {
          console.log(`    ${index + 1}. ${product['product-name']} (${product['console-name']})`);
        });
      } else {
        console.log(`  ❌ API Error: ${data.status}`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

testSmallImport().catch(console.error);
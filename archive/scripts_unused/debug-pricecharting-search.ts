#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets } from '../shared/schema';

async function debugSearch() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🔍 Debugging PriceCharting search for real set...');
  
  // Get a real set
  const sets = await db.select().from(cardSets).limit(1);
  const testSet = sets[0];
  
  console.log(`📋 Testing set: "${testSet.name}"`);
  
  // Search PriceCharting
  const searchQuery = testSet.name;
  const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
  
  console.log(`📡 URL: ${url}`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ Total products returned: ${data.products?.length || 0}`);
    
    if (data.products && data.products.length > 0) {
      console.log('\n🔍 First 10 products:');
      data.products.slice(0, 10).forEach((product: any, index: number) => {
        console.log(`${index + 1}. "${product['product-name']}" (Console: ${product['console-name']})`);
      });
      
      // Check for trading cards
      const potentialCards = data.products.filter((product: any) => {
        const consoleName = product['console-name']?.toLowerCase() || '';
        const productName = product['product-name']?.toLowerCase() || '';
        
        return consoleName.includes('marvel') || 
               consoleName.includes('trading') || 
               consoleName.includes('card') ||
               productName.includes('trading') ||
               productName.includes('card');
      });
      
      console.log(`\n🎯 Products that might be trading cards: ${potentialCards.length}`);
      
      potentialCards.slice(0, 5).forEach((card: any, index: number) => {
        console.log(`${index + 1}. "${card['product-name']}" (Console: ${card['console-name']})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugSearch();
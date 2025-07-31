#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets } from '../shared/schema';

// Function to calculate string similarity
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i - 1] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Function to clean set name for matching
function cleanSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function debugFiltering() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🔍 Debugging filtering logic...');
  
  // Get a real set
  const sets = await db.select().from(cardSets).limit(1);
  const testSet = sets[0];
  
  console.log(`📋 Testing set: "${testSet.name}"`);
  console.log(`📋 Cleaned set name: "${cleanSetName(testSet.name)}"`);
  
  // Search PriceCharting
  const searchQuery = testSet.name;
  const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ Total products returned: ${data.products?.length || 0}`);
    
    if (data.products && data.products.length > 0) {
      console.log('\n🔍 Testing similarity matching:');
      
      // Test first 10 products
      data.products.slice(0, 10).forEach((product: any, index: number) => {
        const consoleName = product['console-name']?.toLowerCase() || '';
        const cleanedConsole = cleanSetName(consoleName);
        const cleanedSetName = cleanSetName(testSet.name);
        
        const similarity = calculateSimilarity(cleanedConsole, cleanedSetName);
        const passes85 = similarity >= 0.85;
        
        console.log(`${index + 1}. "${product['product-name']}"`);
        console.log(`   Console: "${consoleName}"`);
        console.log(`   Cleaned Console: "${cleanedConsole}"`);
        console.log(`   Cleaned Set: "${cleanedSetName}"`);
        console.log(`   Similarity: ${Math.round(similarity * 100)}% ${passes85 ? '✅ PASS' : '❌ FAIL'}`);
        console.log('');
      });
      
      // Count how many pass the filter
      const matches = data.products.filter((product: any) => {
        const consoleName = product['console-name']?.toLowerCase() || '';
        const similarity = calculateSimilarity(cleanSetName(consoleName), cleanSetName(testSet.name));
        return similarity >= 0.85;
      });
      
      console.log(`🎯 Products that pass 85% similarity: ${matches.length}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugFiltering();
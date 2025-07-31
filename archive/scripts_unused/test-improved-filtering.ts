#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets } from '../shared/schema';

// Copy the improved filtering logic
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

function cleanSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTradingCard(product: any): boolean {
  const consoleName = product['console-name']?.toLowerCase() || '';
  const productName = product['product-name']?.toLowerCase() || '';
  
  const tradingCardIndicators = [
    'trading card',
    'card',
    'marvel',
    'x-men',
    'spider-man',
    'fantastic four',
    'avengers',
    'wolverine',
    'deadpool',
    'hulk',
    'iron man',
    'captain america',
    'thor'
  ];
  
  const excludePatterns = [
    'playstation',
    'xbox',
    'nintendo',
    'pc',
    'game',
    'video',
    'dvd',
    'blu-ray',
    'figure',
    'toy',
    'funko'
  ];
  
  const hasCardIndicator = tradingCardIndicators.some(indicator => 
    consoleName.includes(indicator) || productName.includes(indicator)
  );
  
  const hasExcludePattern = excludePatterns.some(pattern =>
    consoleName.includes(pattern) || productName.includes(pattern)
  );
  
  return hasCardIndicator && !hasExcludePattern;
}

async function testImprovedFiltering() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🔍 Testing improved filtering logic...');
  
  // Get a real set
  const sets = await db.select().from(cardSets).limit(1);
  const testSet = sets[0];
  
  console.log(`📋 Testing set: "${testSet.name}"`);
  
  // Search PriceCharting
  const searchQuery = testSet.name;
  const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`✅ Total products returned: ${data.products?.length || 0}`);
    
    if (data.products && data.products.length > 0) {
      // Apply improved filtering
      const tradingCards = data.products.filter(product => {
        const consoleName = product['console-name']?.toLowerCase() || '';
        const productName = product['product-name']?.toLowerCase() || '';
        const setNameLower = testSet.name.toLowerCase();
        
        // Check if this is a trading card
        if (!isTradingCard(product)) {
          return false;
        }
        
        // Multiple matching strategies for better coverage
        const cleanedConsole = cleanSetName(consoleName);
        const cleanedSet = cleanSetName(setNameLower);
        
        // Strategy 1: Direct similarity match (85% threshold)
        const directSimilarity = calculateSimilarity(cleanedConsole, cleanedSet);
        if (directSimilarity >= 0.85) {
          return true;
        }
        
        // Strategy 2: Check if key words from set name appear in console name
        const setWords = cleanedSet.split(' ').filter(word => word.length > 2);
        const consoleWords = cleanedConsole.split(' ');
        const matchingWords = setWords.filter(word => consoleWords.includes(word));
        const wordMatchRatio = matchingWords.length / setWords.length;
        
        if (wordMatchRatio >= 0.6) {
          return true;
        }
        
        // Strategy 3: Check for specific patterns (year, manufacturer, product line)
        const yearMatch = /\d{4}/.exec(cleanedSet);
        const manufacturerMatch = /(upper deck|topps|panini|fleer)/.exec(cleanedSet);
        const productMatch = /(marvel|platinum|chrome|ultra|prizm)/.exec(cleanedSet);
        
        if (yearMatch && manufacturerMatch && productMatch) {
          const hasYear = cleanedConsole.includes(yearMatch[0]);
          const hasManufacturer = cleanedConsole.includes(manufacturerMatch[0]);
          const hasProduct = cleanedConsole.includes(productMatch[0]);
          
          if (hasYear && hasManufacturer && hasProduct) {
            return true;
          }
        }
        
        return false;
      });
      
      console.log(`🎯 Cards that pass improved filtering: ${tradingCards.length}`);
      
      // Show first 10 matches
      console.log('\n🎯 First 10 matches:');
      tradingCards.slice(0, 10).forEach((card: any, index: number) => {
        console.log(`${index + 1}. "${card['product-name']}" (Console: ${card['console-name']})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testImprovedFiltering();
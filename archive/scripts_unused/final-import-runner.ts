#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, readFileSync, existsSync } from 'fs';

interface PriceChartingProduct {
  'product-name': string;
  'console-name': string;
  'loose-price': number;
  'cib-price': number;
  'new-price': number;
  id: string;
}

interface PriceChartingResponse {
  status: string;
  products: PriceChartingProduct[];
}

// Calculate string similarity
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

// Extract card number from product name
function extractCardNumber(productName: string): string | null {
  const match = productName.match(/#(\d+)/);
  return match ? match[1] : null;
}

// Clean set name for matching
function cleanSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if product is a trading card
function isTradingCard(product: PriceChartingProduct): boolean {
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

// Save progress
function saveProgress(setIndex: number, totalSets: number, totalNewCards: number) {
  const progress = {
    setIndex,
    totalSets,
    totalNewCards,
    timestamp: new Date().toISOString()
  };
  writeFileSync('import-progress.json', JSON.stringify(progress, null, 2));
}

// Load progress
function loadProgress(): { setIndex: number; totalSets: number; totalNewCards: number } | null {
  try {
    if (existsSync('import-progress.json')) {
      const data = readFileSync('import-progress.json', 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('No previous progress found, starting fresh');
  }
  return null;
}

async function runFinalImport() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    return;
  }
  
  console.log('🚀 Starting final import for ALL sets...');
  
  const allSets = await db.select().from(cardSets);
  console.log(`📊 Found ${allSets.length} sets to process`);
  
  // Load previous progress
  const prevProgress = loadProgress();
  const startIndex = prevProgress?.setIndex || 0;
  let totalNewCards = prevProgress?.totalNewCards || 0;
  
  if (startIndex > 0) {
    console.log(`📋 Resuming from set ${startIndex + 1}/${allSets.length}`);
  }
  
  // Process each set starting from where we left off
  for (let i = startIndex; i < allSets.length; i++) {
    const set = allSets[i];
    const setNumber = i + 1;
    
    console.log(`\n🔍 [${setNumber}/${allSets.length}] Processing: "${set.name}"`);
    
    try {
      // Get existing cards for this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));
      
      console.log(`📋 Found ${existingCards.length} existing cards in set`);
      
      // Search PriceCharting
      const searchQuery = set.name;
      const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
      
      console.log(`📡 Searching PriceCharting API...`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
        continue;
      }
      
      const data: PriceChartingResponse = await response.json();
      
      if (data.status !== 'success') {
        console.error(`❌ API Error: ${data.status}`);
        continue;
      }
      
      // Filter for trading cards that match this set
      const tradingCards = data.products.filter(product => {
        const consoleName = product['console-name']?.toLowerCase() || '';
        const productName = product['product-name']?.toLowerCase() || '';
        const setNameLower = set.name.toLowerCase();
        
        if (!isTradingCard(product)) {
          return false;
        }
        
        const cleanedConsole = cleanSetName(consoleName);
        const cleanedSet = cleanSetName(setNameLower);
        
        // Strategy 1: Direct similarity match (85% threshold)
        const directSimilarity = calculateSimilarity(cleanedConsole, cleanedSet);
        if (directSimilarity >= 0.85) {
          return true;
        }
        
        // Strategy 2: Word-based matching (60% of words must match)
        const setWords = cleanedSet.split(' ').filter(word => word.length > 2);
        const consoleWords = cleanedConsole.split(' ');
        const matchingWords = setWords.filter(word => consoleWords.includes(word));
        const wordMatchRatio = matchingWords.length / setWords.length;
        
        if (wordMatchRatio >= 0.6) {
          return true;
        }
        
        // Strategy 3: Pattern-based matching
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
      
      console.log(`📦 Found ${tradingCards.length} matching cards in PriceCharting`);
      
      let newCardsForSet = 0;
      
      // Add new cards
      for (const card of tradingCards) {
        const productName = card['product-name'];
        
        if (existingCardNames.has(productName.toLowerCase())) {
          continue; // Skip existing cards silently
        }
        
        const cardNumber = extractCardNumber(productName);
        
        await db.insert(cards).values({
          setId: set.id,
          name: productName,
          cardNumber: cardNumber || '',
          frontImageUrl: '',
          backImageUrl: '',
          variation: '',
          rarity: 'Unknown',
          description: '',
          estimatedValue: card['loose-price'] || 0
        });
        
        newCardsForSet++;
        totalNewCards++;
        console.log(`➕ Added new card: "${productName}"`);
      }
      
      console.log(`✅ Added ${newCardsForSet} new cards to set "${set.name}"`);
      
      // Save progress
      saveProgress(i + 1, allSets.length, totalNewCards);
      
      // Rate limiting - wait 30 seconds between requests
      if (i < allSets.length - 1) {
        const remaining = allSets.length - i - 1;
        console.log(`⏱️  Waiting 30 seconds... (${remaining} sets remaining)`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      
    } catch (error) {
      console.error(`❌ Error processing set "${set.name}":`, error);
      continue;
    }
  }
  
  console.log('\n🎉 IMPORT COMPLETE!');
  console.log(`📊 Total sets processed: ${allSets.length}`);
  console.log(`➕ Total new cards added: ${totalNewCards}`);
  console.log('✅ All sets have been processed');
  
  // Clean up progress file
  if (existsSync('import-progress.json')) {
    writeFileSync('import-progress.json', JSON.stringify({
      completed: true,
      totalSets: allSets.length,
      totalNewCards,
      completedAt: new Date().toISOString()
    }, null, 2));
  }
}

// Main execution
async function main() {
  try {
    await runFinalImport();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
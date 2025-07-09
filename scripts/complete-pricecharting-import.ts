#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

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

interface ImportResult {
  setsProcessed: number;
  setsInserted: number;
  setsSkipped: number;
  cardsProcessed: number;
  cardsInserted: number;
  cardsSkipped: number;
  errors: string[];
  skippedItems: Array<{
    type: 'set' | 'card';
    name: string;
    reason: string;
  }>;
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

// Log progress to file
function logProgress(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp}: ${message}\n`;
  console.log(message);
  writeFileSync('complete-import.log', logEntry, { flag: 'a' });
}

export async function importPriceChartingCards(): Promise<ImportResult> {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  logProgress('🚀 Starting COMPLETE import for ALL 1,114 sets...');
  
  const allSets = await db.select().from(cardSets);
  logProgress(`📊 Found ${allSets.length} sets to process`);
  
  const result: ImportResult = {
    setsProcessed: 0,
    setsInserted: 0,
    setsSkipped: 0,
    cardsProcessed: 0,
    cardsInserted: 0,
    cardsSkipped: 0,
    errors: [],
    skippedItems: []
  };
  
  // Process ALL sets
  for (const [index, set] of allSets.entries()) {
    const setNumber = index + 1;
    result.setsProcessed++;
    
    logProgress(`🔍 [${setNumber}/${allSets.length}] Processing: "${set.name}"`);
    
    try {
      // Get existing cards for this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));
      
      logProgress(`📋 Found ${existingCards.length} existing cards in set`);
      
      // Search PriceCharting
      const searchQuery = set.name;
      const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const error = `HTTP ${response.status}: ${response.statusText}`;
        result.errors.push(error);
        result.skippedItems.push({
          type: 'set',
          name: set.name,
          reason: error
        });
        continue;
      }
      
      const data: PriceChartingResponse = await response.json();
      
      if (data.status !== 'success') {
        const error = `API Error: ${data.status}`;
        result.errors.push(error);
        result.skippedItems.push({
          type: 'set',
          name: set.name,
          reason: error
        });
        continue;
      }
      
      // Filter for trading cards that match this set
      const tradingCards = data.products.filter(product => {
        const consoleName = product['console-name']?.toLowerCase() || '';
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
      
      logProgress(`📦 Found ${tradingCards.length} matching cards in PriceCharting`);
      result.cardsProcessed += tradingCards.length;
      
      let newCardsForSet = 0;
      
      // Add new cards
      for (const card of tradingCards) {
        const productName = card['product-name'];
        
        if (existingCardNames.has(productName.toLowerCase())) {
          result.cardsSkipped++;
          continue;
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
        result.cardsInserted++;
      }
      
      if (newCardsForSet > 0) {
        result.setsInserted++;
      } else {
        result.setsSkipped++;
      }
      
      logProgress(`✅ Added ${newCardsForSet} new cards to set "${set.name}"`);
      
      // Progress update every 10 sets
      if (setNumber % 10 === 0) {
        logProgress(`📊 Progress: ${setNumber}/${allSets.length} sets processed (${result.cardsInserted} cards added)`);
      }
      
      // Rate limiting - wait 30 seconds between requests
      if (index < allSets.length - 1) {
        const remaining = allSets.length - index - 1;
        logProgress(`⏱️  Waiting 30 seconds... (${remaining} sets remaining)`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      
    } catch (error) {
      const errorMessage = `Error processing set "${set.name}": ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMessage);
      result.skippedItems.push({
        type: 'set',
        name: set.name,
        reason: errorMessage
      });
      logProgress(`❌ ${errorMessage}`);
    }
  }
  
  logProgress('🎉 IMPORT COMPLETE!');
  logProgress(`📊 Final Results:`);
  logProgress(`   - Total sets processed: ${result.setsProcessed}`);
  logProgress(`   - Sets with new cards: ${result.setsInserted}`);
  logProgress(`   - Sets skipped: ${result.setsSkipped}`);
  logProgress(`   - Total cards processed: ${result.cardsProcessed}`);
  logProgress(`   - Total new cards added: ${result.cardsInserted}`);
  logProgress(`   - Cards skipped (already exist): ${result.cardsSkipped}`);
  logProgress(`   - Errors: ${result.errors.length}`);
  
  return result;
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importPriceChartingCards()
    .then(result => {
      console.log('\n🎯 Final Import Results:');
      console.log(`   Sets processed: ${result.setsProcessed}`);
      console.log(`   Sets with new cards: ${result.setsInserted}`);
      console.log(`   Sets skipped: ${result.setsSkipped}`);
      console.log(`   Cards processed: ${result.cardsProcessed}`);
      console.log(`   Cards inserted: ${result.cardsInserted}`);
      console.log(`   Cards skipped: ${result.cardsSkipped}`);
      console.log(`   Errors: ${result.errors.length}`);
      
      if (result.errors.length > 0) {
        console.log('\n❌ Errors:');
        result.errors.forEach(error => console.log(`   - ${error}`));
      }
      
      console.log('\n✅ Import completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}
#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, appendFileSync } from 'fs';

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

interface ImportStats {
  totalProductsProcessed: number;
  totalCardsAdded: number;
  cardsSkipped: number;
  setsSkipped: number;
  setsProcessed: number;
  errors: string[];
}

const LOG_FILE = 'complete-import.log';
const isDryRun = process.argv.includes('--dry-run');

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp}: ${message}`;
  console.log(logEntry);
  
  if (!isDryRun) {
    try {
      appendFileSync(LOG_FILE, logEntry + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
}

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

function extractCardNumber(productName: string): string {
  const patterns = [
    /#(\d+)/,
    /No\.\s*(\d+)/i,
    /Card\s*(\d+)/i,
    /\b(\d+)\b/
  ];
  
  for (const pattern of patterns) {
    const match = productName.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return '';
}

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

function findMatchingSet(product: PriceChartingProduct, sets: any[]): any | null {
  const consoleName = product['console-name']?.toLowerCase() || '';
  
  for (const set of sets) {
    const setNameLower = set.name.toLowerCase();
    const cleanedConsole = cleanSetName(consoleName);
    const cleanedSet = cleanSetName(setNameLower);
    
    // Strategy 1: Direct similarity match (85% threshold)
    const directSimilarity = calculateSimilarity(cleanedConsole, cleanedSet);
    if (directSimilarity >= 0.85) {
      return set;
    }
    
    // Strategy 2: Word-based matching (60% of words must match)
    const setWords = cleanedSet.split(' ').filter(word => word.length > 2);
    const consoleWords = cleanedConsole.split(' ');
    const matchingWords = setWords.filter(word => consoleWords.includes(word));
    const wordMatchRatio = matchingWords.length / setWords.length;
    
    if (wordMatchRatio >= 0.6) {
      return set;
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
        return set;
      }
    }
  }
  
  return null;
}

async function runImport(): Promise<ImportStats> {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  const stats: ImportStats = {
    totalProductsProcessed: 0,
    totalCardsAdded: 0,
    cardsSkipped: 0,
    setsSkipped: 0,
    setsProcessed: 0,
    errors: []
  };
  
  // Initialize log file
  if (!isDryRun) {
    writeFileSync(LOG_FILE, `=== PriceCharting Import Started at ${new Date().toISOString()} ===\n`);
  }
  
  log(`Starting PriceCharting import${isDryRun ? ' (DRY RUN)' : ''}`);
  
  // Load all sets from database
  log('Loading card sets from database...');
  const allSets = await db.select().from(cardSets);
  log(`Found ${allSets.length} card sets in database`);
  
  // Process each set individually by searching PriceCharting
  log('Processing each set by searching PriceCharting...');
  
  const allProducts: PriceChartingProduct[] = [];
  
  for (const [setIndex, set] of allSets.entries()) {
    const setNumber = setIndex + 1;
    log(`[${setNumber}/${allSets.length}] Searching for: "${set.name}"`);
    
    try {
      // Search for this specific set
      const searchUrl = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(set.name)}`;
      const searchResponse = await fetch(searchUrl);
      
      if (!searchResponse.ok) {
        stats.errors.push(`HTTP ${searchResponse.status} for set "${set.name}"`);
        continue;
      }
      
      const searchData: PriceChartingResponse = await searchResponse.json();
      if (searchData.status !== 'success') {
        stats.errors.push(`API Error ${searchData.status} for set "${set.name}"`);
        continue;
      }
      
      // Filter for trading cards that match this set
      const setTradingCards = searchData.products.filter(product => {
        if (!isTradingCard(product)) return false;
        
        const matchingSet = findMatchingSet(product, [set]);
        return matchingSet !== null;
      });
      
      log(`Found ${setTradingCards.length} matching cards for "${set.name}"`);
      allProducts.push(...setTradingCards);
      
      // Add small delay between API calls
      if (setIndex < allSets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      const errorMessage = `Error searching for set "${set.name}": ${error instanceof Error ? error.message : String(error)}`;
      stats.errors.push(errorMessage);
      log(`ERROR: ${errorMessage}`);
    }
  }
  
  log(`Total products found across all sets: ${allProducts.length}`);
  
  // Process each product
  for (const [index, product] of allProducts.entries()) {
    const productNumber = index + 1;
    stats.totalProductsProcessed++;
    
    if (productNumber % 100 === 0) {
      log(`Progress: ${productNumber}/${allProducts.length} products processed`);
    }
    
    try {
      // Find matching set
      const matchingSet = findMatchingSet(product, allSets);
      
      if (!matchingSet) {
        stats.setsSkipped++;
        continue;
      }
      
      // Check if card already exists
      const productName = product['product-name'];
      const existingCard = await db.select().from(cards).where(
        eq(cards.setId, matchingSet.id)
      );
      
      const existingCardNames = new Set(existingCard.map(card => card.name.toLowerCase()));
      
      if (existingCardNames.has(productName.toLowerCase())) {
        stats.cardsSkipped++;
        continue;
      }
      
      // Insert new card
      const cardNumber = extractCardNumber(productName);
      const estimatedValue = product['loose-price'] || product['cib-price'] || product['new-price'] || 0;
      
      if (!isDryRun) {
        await db.insert(cards).values({
          setId: matchingSet.id,
          name: productName,
          cardNumber,
          frontImageUrl: '',
          backImageUrl: '',
          variation: '',
          rarity: 'Unknown',
          description: '',
          estimatedValue
        });
      }
      
      stats.totalCardsAdded++;
      
      if (stats.totalCardsAdded % 50 === 0) {
        log(`Added ${stats.totalCardsAdded} cards so far...`);
      }
      
    } catch (error) {
      const errorMessage = `Error processing product "${product['product-name']}": ${error instanceof Error ? error.message : String(error)}`;
      stats.errors.push(errorMessage);
      log(`ERROR: ${errorMessage}`);
    }
  }
  
  return stats;
}

async function main() {
  try {
    log('=== PriceCharting Import Script ===');
    log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
    
    const stats = await runImport();
    
    log('=== IMPORT COMPLETE ===');
    log(`Total products processed: ${stats.totalProductsProcessed}`);
    log(`Total cards added: ${stats.totalCardsAdded}`);
    log(`Cards skipped (already exist): ${stats.cardsSkipped}`);
    log(`Sets skipped (no match): ${stats.setsSkipped}`);
    log(`Errors: ${stats.errors.length}`);
    
    if (stats.errors.length > 0) {
      log('=== ERRORS ===');
      stats.errors.forEach(error => log(`ERROR: ${error}`));
    }
    
    log('=== SUMMARY ===');
    console.log('\n🎯 Import Summary:');
    console.log(`   Total products processed: ${stats.totalProductsProcessed}`);
    console.log(`   Total cards added: ${stats.totalCardsAdded}`);
    console.log(`   Cards skipped (already exist): ${stats.cardsSkipped}`);
    console.log(`   Sets skipped (no match): ${stats.setsSkipped}`);
    console.log(`   Errors: ${stats.errors.length}`);
    
    if (isDryRun) {
      console.log('\n⚠️  This was a DRY RUN - no changes were made to the database');
      console.log('Run without --dry-run to perform the actual import');
    } else {
      console.log(`\n📄 Full log written to: ${LOG_FILE}`);
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    log(`FATAL ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the script
main();
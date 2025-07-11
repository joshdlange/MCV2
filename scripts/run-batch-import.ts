#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, appendFileSync, readFileSync } from 'fs';

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

interface BatchProgress {
  lastProcessedIndex: number;
  totalCardsAdded: number;
  totalSetsProcessed: number;
  timestamp: string;
}

const BATCH_SIZE = 10; // Process 10 sets at a time
const PROGRESS_FILE = 'batch-import-progress.json';
const LOG_FILE = 'batch-import.log';

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp}: ${message}`;
  console.log(logEntry);
  
  try {
    appendFileSync(LOG_FILE, logEntry + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}

function loadProgress(): BatchProgress {
  try {
    const data = readFileSync(PROGRESS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      lastProcessedIndex: -1,
      totalCardsAdded: 0,
      totalSetsProcessed: 0,
      timestamp: new Date().toISOString()
    };
  }
}

function saveProgress(progress: BatchProgress) {
  try {
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (error) {
    console.error('Failed to save progress:', error);
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
  }
  
  return null;
}

async function runBatchImport(): Promise<void> {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  log('=== Starting Batch PriceCharting Import ===');
  
  // Load progress
  const progress = loadProgress();
  log(`Resuming from index: ${progress.lastProcessedIndex + 1}`);
  log(`Previous totals: ${progress.totalCardsAdded} cards, ${progress.totalSetsProcessed} sets`);
  
  // Load all sets
  const allSets = await db.select().from(cardSets);
  log(`Found ${allSets.length} total sets in database`);
  
  // Calculate batch range
  const startIndex = progress.lastProcessedIndex + 1;
  const endIndex = Math.min(startIndex + BATCH_SIZE, allSets.length);
  
  if (startIndex >= allSets.length) {
    log('🎉 ALL SETS HAVE BEEN PROCESSED!');
    log(`Final totals: ${progress.totalCardsAdded} cards added, ${progress.totalSetsProcessed} sets processed`);
    return;
  }
  
  const batchSets = allSets.slice(startIndex, endIndex);
  log(`Processing batch: sets ${startIndex + 1} to ${endIndex} (${batchSets.length} sets)`);
  
  let batchCardsAdded = 0;
  
  for (const [batchIndex, set] of batchSets.entries()) {
    const globalIndex = startIndex + batchIndex;
    const setNumber = globalIndex + 1;
    
    log(`[${setNumber}/${allSets.length}] Processing: "${set.name}"`);
    
    try {
      // Get existing cards for this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));
      
      // Search PriceCharting for this set
      const searchUrl = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(set.name)}`;
      const response = await fetch(searchUrl);
      
      if (!response.ok) {
        log(`ERROR: HTTP ${response.status} for set "${set.name}"`);
        continue;
      }
      
      const data: PriceChartingResponse = await response.json();
      if (data.status !== 'success') {
        log(`ERROR: API ${data.status} for set "${set.name}"`);
        continue;
      }
      
      // Filter matching cards
      const matchingCards = data.products.filter(product => {
        if (!isTradingCard(product)) return false;
        const matchingSet = findMatchingSet(product, [set]);
        return matchingSet !== null;
      });
      
      log(`Found ${matchingCards.length} matching cards for "${set.name}"`);
      
      // Add new cards
      let newCardsForSet = 0;
      for (const card of matchingCards) {
        const productName = card['product-name'];
        
        if (existingCardNames.has(productName.toLowerCase())) {
          continue; // Skip existing cards
        }
        
        const cardNumber = extractCardNumber(productName);
        const estimatedValue = card['loose-price'] || card['cib-price'] || card['new-price'] || 0;
        
        await db.insert(cards).values({
          setId: set.id,
          name: productName,
          cardNumber,
          frontImageUrl: '',
          backImageUrl: '',
          variation: '',
          rarity: 'Unknown',
          description: '',
          estimatedValue
        });
        
        newCardsForSet++;
        batchCardsAdded++;
      }
      
      log(`✅ Added ${newCardsForSet} new cards to "${set.name}"`);
      
      // Update progress
      progress.lastProcessedIndex = globalIndex;
      progress.totalCardsAdded += newCardsForSet;
      progress.totalSetsProcessed++;
      progress.timestamp = new Date().toISOString();
      saveProgress(progress);
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      log(`ERROR processing set "${set.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  log('=== Batch Complete ===');
  log(`Batch results: ${batchCardsAdded} cards added in this batch`);
  log(`Running totals: ${progress.totalCardsAdded} cards, ${progress.totalSetsProcessed} sets`);
  log(`Next batch will start at set ${endIndex + 1}`);
  
  const remainingSets = allSets.length - (endIndex);
  if (remainingSets > 0) {
    log(`${remainingSets} sets remaining. Run the script again to continue.`);
  } else {
    log('🎉 ALL SETS COMPLETE!');
  }
}

async function main() {
  try {
    await runBatchImport();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    log(`FATAL ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
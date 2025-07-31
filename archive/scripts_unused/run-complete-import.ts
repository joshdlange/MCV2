#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

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

async function runCompleteImport() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  try {
    console.log('🚀 Starting COMPLETE PriceCharting import for all sets...');
    console.log('📊 Loading existing card sets...');
    
    const existingSets = await db.select().from(cardSets);
    console.log(`✅ Found ${existingSets.length} existing card sets`);
    
    let totalNewCards = 0;
    let processedSets = 0;
    let setsWithMatches = 0;
    
    // Process each set
    for (let i = 0; i < existingSets.length; i++) {
      const set = existingSets[i];
      const setNumber = i + 1;
      
      console.log(`\n🔍 [${setNumber}/${existingSets.length}] Processing set: "${set.name}"`);
      processedSets++;
      
      try {
        // Get existing cards
        const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
        const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));
        
        console.log(`📋 Set has ${existingCards.length} existing cards`);
        
        // Search PriceCharting
        const searchQuery = set.name;
        const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
        
        console.log(`📡 Searching PriceCharting for: "${searchQuery}"`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`❌ HTTP ${response.status}: ${response.statusText} for set "${set.name}"`);
          continue;
        }
        
        const data: PriceChartingResponse = await response.json();
        
        if (data.status !== 'success') {
          console.error(`❌ API Error: ${data.status} for set "${set.name}"`);
          continue;
        }
        
        // Filter for trading cards that match this set
        const tradingCards = data.products.filter(product => {
          const consoleName = product['console-name']?.toLowerCase() || '';
          const productName = product['product-name']?.toLowerCase() || '';
          const setNameLower = set.name.toLowerCase();
          
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
          
          // Strategy 2: Word-based matching (60% of words must match)
          const setWords = cleanedSet.split(' ').filter(word => word.length > 2);
          const consoleWords = cleanedConsole.split(' ');
          const matchingWords = setWords.filter(word => consoleWords.includes(word));
          const wordMatchRatio = matchingWords.length / setWords.length;
          
          if (wordMatchRatio >= 0.6) {
            return true;
          }
          
          // Strategy 3: Pattern-based matching for specific formats
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
        
        console.log(`📦 Found ${tradingCards.length} matching trading cards in PriceCharting`);
        
        if (tradingCards.length > 0) {
          setsWithMatches++;
        }
        
        let newCardsForSet = 0;
        
        // Add new cards
        for (const card of tradingCards) {
          const productName = card['product-name'];
          
          if (existingCardNames.has(productName.toLowerCase())) {
            console.log(`⏭️  Card "${productName}" already exists in set`);
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
          totalNewCards++;
          console.log(`➕ Added new card: "${productName}" (${cardNumber || 'no number'})`);
        }
        
        console.log(`✅ Added ${newCardsForSet} new cards to set "${set.name}"`);
        
        // Rate limiting - wait 30 seconds between requests
        if (i < existingSets.length - 1) {
          console.log(`⏱️  Waiting 30 seconds before next request... (${existingSets.length - i - 1} sets remaining)`);
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
        
      } catch (error) {
        console.error(`❌ Error processing set "${set.name}":`, error);
        continue;
      }
    }
    
    console.log('\n🎉 COMPLETE IMPORT SUMMARY:');
    console.log(`📊 Total sets processed: ${processedSets}`);
    console.log(`🎯 Sets with matching cards found: ${setsWithMatches}`);
    console.log(`➕ Total new cards added: ${totalNewCards}`);
    console.log(`⏭️  Sets with no matches: ${processedSets - setsWithMatches}`);
    console.log(`✅ Import completed successfully!`);
    
  } catch (error) {
    console.error('❌ Error during import:', error);
    process.exit(1);
  }
}

// Run the import
runCompleteImport().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
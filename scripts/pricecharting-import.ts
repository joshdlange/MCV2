#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

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

// Function to extract card number from product name
function extractCardNumber(productName: string): string | null {
  // Look for patterns like "#123", "No. 123", or "Card 123"
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
  
  return null;
}

// Function to clean set name for matching
function cleanSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Function to check if a product is a trading card
function isTradingCard(product: PriceChartingProduct): boolean {
  const consoleName = product['console-name']?.toLowerCase() || '';
  const productName = product['product-name']?.toLowerCase() || '';
  
  // Check for trading card indicators
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
  
  // Exclude video games and other non-card items
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

async function importPriceChartingCards() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🚀 Starting PriceCharting import for existing sets...');
  
  try {
    // Get existing card sets from database
    console.log('📊 Loading existing card sets...');
    const existingSets = await db.select().from(cardSets);
    console.log(`✅ Found ${existingSets.length} existing card sets`);
    
    let totalNewCards = 0;
    let processedSets = 0;
    let setsWithMatches = 0;
    
    // Process each existing set
    for (const set of existingSets) {
      console.log(`\n🔍 Processing set: "${set.name}"`);
      processedSets++;
      
      // Get existing cards for this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));
      
      console.log(`📋 Set has ${existingCards.length} existing cards`);
      
      // Search PriceCharting for this specific set
      const searchQuery = set.name;
      const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(searchQuery)}`;
      
      console.log(`📡 Searching PriceCharting for: "${searchQuery}"`);
      
      try {
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
          
          // Check if the console name matches the set name (85% similarity)
          const similarity = calculateSimilarity(cleanSetName(consoleName), cleanSetName(setNameLower));
          return similarity >= 0.85;
        });
        
        console.log(`📦 Found ${tradingCards.length} matching trading cards in PriceCharting`);
        
        if (tradingCards.length === 0) {
          console.log(`⚠️  No trading cards found for set "${set.name}"`);
          continue;
        }
        
        setsWithMatches++;
        let newCardsForSet = 0;
        
        // Process each card
        for (const card of tradingCards) {
          const productName = card['product-name'];
          const productNameLower = productName.toLowerCase();
          
          // Check if card already exists
          if (existingCardNames.has(productNameLower)) {
            console.log(`⏭️  Card "${productName}" already exists in set`);
            continue;
          }
          
          // Extract card number
          const cardNumber = extractCardNumber(productName);
          
          // Add new card
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
        
        // Rate limiting - wait 30 seconds between requests as per API requirements
        if (processedSets < existingSets.length) {
          console.log('⏱️  Waiting 30 seconds before next request...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
        
      } catch (error) {
        console.error(`❌ Error processing set "${set.name}":`, error);
        continue;
      }
    }
    
    console.log('\n🎉 Import Summary:');
    console.log(`📊 Total sets processed: ${processedSets}`);
    console.log(`🎯 Sets with matching cards found: ${setsWithMatches}`);
    console.log(`➕ Total new cards added: ${totalNewCards}`);
    console.log(`⏭️  Sets with no matches: ${processedSets - setsWithMatches}`);
    
  } catch (error) {
    console.error('❌ Error during import:', error);
    process.exit(1);
  }
}

// Export the function for API use
export { importPriceChartingCards };

// Run the import when called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importPriceChartingCards();
}
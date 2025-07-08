#!/usr/bin/env tsx

import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, and, sql } from 'drizzle-orm';

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
  
  console.log('🚀 Starting PriceCharting import...');
  
  try {
    // Get existing card sets from database
    console.log('📊 Loading existing card sets...');
    const existingSets = await db.select().from(cardSets);
    console.log(`✅ Found ${existingSets.length} existing card sets`);
    
    // Search for Marvel trading cards
    console.log('🔍 Searching PriceCharting for Marvel trading cards...');
    const searchQueries = [
      'marvel',
      'marvel trading card',
      'marvel x-men',
      'marvel spider-man',
      'marvel avengers',
      'marvel fantastic four'
    ];
    
    let allTradingCards: PriceChartingProduct[] = [];
    let processedUrls = new Set<string>();
    
    for (const query of searchQueries) {
      console.log(`🔍 Searching for: "${query}"`);
      
      const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(query)}`;
      
      // Skip if we've already processed this URL
      if (processedUrls.has(url)) {
        console.log('⏭️  Skipping duplicate URL');
        continue;
      }
      processedUrls.add(url);
      
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
      
      // Filter for trading cards
      const tradingCards = data.products.filter(isTradingCard);
      console.log(`📦 Found ${tradingCards.length} trading cards out of ${data.products.length} total products`);
      
      allTradingCards.push(...tradingCards);
      
      // Add delay between requests (5 minutes as per API docs)
      console.log('⏱️  Waiting 30 seconds before next request...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    // Remove duplicates
    const uniqueCards = allTradingCards.filter((card, index, self) => 
      index === self.findIndex(c => c.id === card.id)
    );
    
    console.log(`🎯 Found ${uniqueCards.length} unique trading cards`);
    
    // Match cards to existing sets
    console.log('🔄 Matching cards to existing sets...');
    let matchedCards = 0;
    let newCardsAdded = 0;
    
    for (const card of uniqueCards) {
      const consoleName = card['console-name'];
      const productName = card['product-name'];
      
      // Find matching set with 85% similarity threshold
      let bestMatch: typeof existingSets[0] | null = null;
      let bestSimilarity = 0;
      
      for (const set of existingSets) {
        const similarity = calculateSimilarity(
          cleanSetName(consoleName),
          cleanSetName(set.name)
        );
        
        if (similarity > bestSimilarity && similarity >= 0.85) {
          bestMatch = set;
          bestSimilarity = similarity;
        }
      }
      
      if (bestMatch) {
        matchedCards++;
        console.log(`✅ Matched "${productName}" to set "${bestMatch.name}" (${Math.round(bestSimilarity * 100)}% similarity)`);
        
        // Extract card number
        const cardNumber = extractCardNumber(productName);
        
        // Check if card already exists
        const existingCard = await db.select().from(cards).where(
          and(
            eq(cards.cardSetId, bestMatch.id),
            eq(cards.name, productName)
          )
        ).limit(1);
        
        if (existingCard.length === 0) {
          // Add new card
          await db.insert(cards).values({
            cardSetId: bestMatch.id,
            name: productName,
            cardNumber: cardNumber || '',
            frontImage: '',
            backImage: '',
            variation: '',
            rarity: '',
            artist: '',
            description: '',
            releaseDate: '',
            priceHistory: JSON.stringify([{
              date: new Date().toISOString(),
              price: card['loose-price'] || 0,
              source: 'pricecharting'
            }])
          });
          
          newCardsAdded++;
          console.log(`➕ Added new card: "${productName}" to set "${bestMatch.name}"`);
        } else {
          console.log(`⏭️  Card "${productName}" already exists in set "${bestMatch.name}"`);
        }
      } else {
        console.log(`⚠️  No matching set found for "${consoleName}" - "${productName}"`);
      }
    }
    
    console.log('\n🎉 Import Summary:');
    console.log(`📊 Total trading cards found: ${uniqueCards.length}`);
    console.log(`🎯 Cards matched to existing sets: ${matchedCards}`);
    console.log(`➕ New cards added: ${newCardsAdded}`);
    console.log(`⏭️  Cards skipped (already exist): ${matchedCards - newCardsAdded}`);
    console.log(`⚠️  Cards not matched: ${uniqueCards.length - matchedCards}`);
    
  } catch (error) {
    console.error('❌ Error during import:', error);
    process.exit(1);
  }
}

// Run the import
importPriceChartingCards();
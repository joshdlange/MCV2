import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { cardSets, cards } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

interface PriceChartingProduct {
  id: string;
  'product-name': string;
  'console-name': string;
  'loose-price'?: number;
  'cib-price'?: number;
  'new-price'?: number;
  image?: string;
}

interface PriceChartingResponse {
  products: PriceChartingProduct[];
}

const API_KEY = process.env.PRICECHARTING_API_KEY;
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds to be safe
const BATCH_SIZE = 25; // Process in batches for progress updates

function formatSetName(name: string): string {
  return name.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseCardName(productName: string): { name: string; cardNumber: string } {
  const hashMatch = productName.match(/^(.+?)\s+#(\w+)$/);
  if (hashMatch) {
    return {
      name: hashMatch[1].trim(),
      cardNumber: hashMatch[2]
    };
  }
  
  const numberMatch = productName.match(/^(.+?)\s+(\d+)$/);
  if (numberMatch) {
    return {
      name: numberMatch[1].trim(),
      cardNumber: numberMatch[2]
    };
  }
  
  // Generate a unique card number based on the product name
  const cardNumber = productName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10) || 'PROMO';
  
  return {
    name: productName.trim(),
    cardNumber: cardNumber
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPriceChartingProducts(query: string): Promise<PriceChartingProduct[]> {
  const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(query)}&t=${API_KEY}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data: PriceChartingResponse = await response.json();
    return data.products || [];
  } catch (error) {
    console.error(`Error fetching from PriceCharting: ${error}`);
    return [];
  }
}

async function processSet(set: any, setIndex: number, totalSets: number): Promise<number> {
  console.log(`[${setIndex + 1}/${totalSets}] Processing: "${set.name}" (ID: ${set.id})`);
  
  // Get existing cards in this set
  const existingCards = await db
    .select({ name: cards.name, cardNumber: cards.cardNumber })
    .from(cards)
    .where(eq(cards.setId, set.id));
  
  const existingCardMap = new Map();
  existingCards.forEach(card => {
    const key = `${card.name}|${card.cardNumber || ''}`;
    existingCardMap.set(key, true);
  });
  
  console.log(`  Current cards in set: ${existingCards.length}`);
  
  // Format set name for PriceCharting query
  const query = formatSetName(set.name);
  console.log(`  Query: "${query}"`);
  
  // Fetch products from PriceCharting
  const products = await fetchPriceChartingProducts(query);
  console.log(`  Found ${products.length} products from PriceCharting`);
  
  if (products.length === 0) {
    console.log(`  ⚠️  No products found for "${set.name}"`);
    return 0;
  }
  
  // Process each product
  let addedCount = 0;
  
  for (const product of products) {
    const { name, cardNumber } = parseCardName(product['product-name']);
    const key = `${name}|${cardNumber || ''}`;
    
    // Skip if card already exists
    if (existingCardMap.has(key)) {
      continue;
    }
    
    // Add new card
    try {
      await db.insert(cards).values({
        name: name,
        cardNumber: cardNumber,
        setId: set.id,
        frontImageUrl: product.image || null,
        rarity: 'Common', // Default rarity
        estimatedValue: product['loose-price'] ? product['loose-price'].toString() : null
      });
      
      addedCount++;
    } catch (error) {
      console.error(`  Error adding card "${name}": ${error}`);
    }
  }
  
  console.log(`  ✅ Added ${addedCount} new cards to set`);
  return addedCount;
}

async function runCompleteImport(): Promise<void> {
  console.log('='.repeat(50));
  console.log('COMPLETE PRICECHARTING IMPORT - PROCESSING ALL SETS');
  console.log('='.repeat(50));
  
  if (!API_KEY) {
    console.error('❌ PRICECHARTING_API_KEY environment variable not set');
    process.exit(1);
  }
  
  console.log('✅ API Key present');
  console.log(`⏱️  Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`);
  
  // Get baseline card count
  const baselineResult = await db.select().from(cards);
  const baselineCount = baselineResult.length;
  console.log(`📊 Baseline card count: ${baselineCount}`);
  
  // Get all card sets
  const allSets = await db.select().from(cardSets).orderBy(cardSets.id);
  const totalSets = allSets.length;
  console.log(`📁 Total sets to process: ${totalSets}`);
  
  let totalAdded = 0;
  let processedSets = 0;
  
  // Process sets in batches
  for (let i = 0; i < allSets.length; i += BATCH_SIZE) {
    const batch = allSets.slice(i, i + BATCH_SIZE);
    
    for (const set of batch) {
      try {
        const addedCount = await processSet(set, i + batch.indexOf(set), totalSets);
        totalAdded += addedCount;
        processedSets++;
        
        // Add delay between requests
        await sleep(DELAY_BETWEEN_REQUESTS);
      } catch (error) {
        console.error(`❌ Error processing set "${set.name}": ${error}`);
      }
    }
    
    // Progress update every batch
    console.log(`\n📊 PROGRESS UPDATE: ${processedSets}/${totalSets} sets processed (${Math.round(processedSets / totalSets * 100)}%)`);
    console.log(`🆕 Total new cards added so far: ${totalAdded}`);
    console.log('-'.repeat(50));
  }
  
  // Final summary
  const finalResult = await db.select().from(cards);
  const finalCount = finalResult.length;
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 IMPORT COMPLETE!');
  console.log('='.repeat(50));
  console.log(`📊 Final Statistics:`);
  console.log(`   - Sets processed: ${processedSets}/${totalSets}`);
  console.log(`   - Cards before: ${baselineCount}`);
  console.log(`   - Cards after: ${finalCount}`);
  console.log(`   - New cards added: ${totalAdded}`);
  console.log(`   - Database growth: ${((finalCount - baselineCount) / baselineCount * 100).toFixed(1)}%`);
  console.log('='.repeat(50));
}

// Run the import
runCompleteImport().catch(error => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { cardSets, cards } from '../shared/schema';
import fs from 'fs';

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
const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds for stability
const PROGRESS_FILE = 'import-progress.json';

// Load or create progress tracking
function loadProgress(): { lastProcessedSetId: number; totalProcessed: number; totalAdded: number } {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (error) {
    console.log('No existing progress file, starting fresh');
  }
  return { lastProcessedSetId: 0, totalProcessed: 0, totalAdded: 0 };
}

function saveProgress(progress: { lastProcessedSetId: number; totalProcessed: number; totalAdded: number }) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

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

async function processSet(set: any): Promise<number> {
  console.log(`Processing: "${set.name}" (ID: ${set.id})`);
  
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

async function runPersistentImport(): Promise<void> {
  console.log('='.repeat(60));
  console.log('PERSISTENT PRICECHARTING IMPORT - CONTINUOUS PROCESSING');
  console.log('='.repeat(60));
  
  if (!API_KEY) {
    console.error('❌ PRICECHARTING_API_KEY environment variable not set');
    process.exit(1);
  }
  
  console.log('✅ API Key present');
  console.log(`⏱️  Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`);
  
  // Load progress
  const progress = loadProgress();
  console.log(`📊 Resuming from set ID: ${progress.lastProcessedSetId}`);
  console.log(`📈 Previously processed: ${progress.totalProcessed} sets`);
  console.log(`📈 Previously added: ${progress.totalAdded} cards`);
  
  // Get all card sets starting from last processed
  const allSets = await db
    .select()
    .from(cardSets)
    .where(eq(cardSets.id, progress.lastProcessedSetId > 0 ? progress.lastProcessedSetId : 1))
    .orderBy(cardSets.id);
  
  console.log(`📁 Total sets remaining to process: ${allSets.length}`);
  
  const startTime = Date.now();
  
  // Process sets continuously
  for (const set of allSets) {
    try {
      const addedCount = await processSet(set);
      
      // Update progress
      progress.lastProcessedSetId = set.id;
      progress.totalProcessed++;
      progress.totalAdded += addedCount;
      
      // Save progress every set
      saveProgress(progress);
      
      // Log progress every 10 sets
      if (progress.totalProcessed % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n📊 PROGRESS UPDATE:`);
        console.log(`   Sets processed: ${progress.totalProcessed}`);
        console.log(`   Cards added: ${progress.totalAdded}`);
        console.log(`   Time elapsed: ${Math.floor(elapsed)}s`);
        console.log(`   Last set: "${set.name}"`);
        console.log('-'.repeat(40));
      }
      
      // Wait before next request
      await sleep(DELAY_BETWEEN_REQUESTS);
      
    } catch (error) {
      console.error(`❌ Error processing set "${set.name}": ${error}`);
      // Continue with next set instead of stopping
      progress.lastProcessedSetId = set.id;
      progress.totalProcessed++;
      saveProgress(progress);
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }
  
  console.log('\n🎉 IMPORT COMPLETE!');
  console.log(`✅ Total sets processed: ${progress.totalProcessed}`);
  console.log(`✅ Total cards added: ${progress.totalAdded}`);
  console.log(`⏱️  Total time: ${Math.floor((Date.now() - startTime) / 1000)}s`);
  
  // Clean up progress file
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Import interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Import terminated');
  process.exit(0);
});

runPersistentImport().catch(console.error);
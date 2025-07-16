import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { cardSets, cards } from '../shared/schema';

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
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds

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

async function processAllSets(): Promise<void> {
  console.log('SINGLE RUN PRICECHARTING IMPORT - PROCESSING ALL SETS');
  console.log('='.repeat(60));
  
  if (!API_KEY) {
    console.error('❌ PRICECHARTING_API_KEY environment variable not set');
    process.exit(1);
  }
  
  // Get baseline count
  const baselineResult = await db.select().from(cards);
  const baselineCount = baselineResult.length;
  console.log(`📊 Starting card count: ${baselineCount}`);
  
  // Get all sets
  const allSets = await db.select().from(cardSets).orderBy(cardSets.id);
  console.log(`📁 Total sets to process: ${allSets.length}`);
  
  let totalAdded = 0;
  const startTime = Date.now();
  
  // Process every single set
  for (let i = 0; i < allSets.length; i++) {
    const set = allSets[i];
    console.log(`\n[${i + 1}/${allSets.length}] Processing: "${set.name}" (ID: ${set.id})`);
    
    try {
      // Get existing cards
      const existingCards = await db
        .select({ name: cards.name, cardNumber: cards.cardNumber })
        .from(cards)
        .where(eq(cards.setId, set.id));
      
      const existingCardMap = new Map();
      existingCards.forEach(card => {
        const key = `${card.name}|${card.cardNumber || ''}`;
        existingCardMap.set(key, true);
      });
      
      console.log(`  Current cards: ${existingCards.length}`);
      
      // Fetch from PriceCharting
      const query = formatSetName(set.name);
      const products = await fetchPriceChartingProducts(query);
      console.log(`  Found ${products.length} products from PriceCharting`);
      
      let addedCount = 0;
      
      // Process each product
      for (const product of products) {
        const { name, cardNumber } = parseCardName(product['product-name']);
        const key = `${name}|${cardNumber || ''}`;
        
        if (!existingCardMap.has(key)) {
          try {
            await db.insert(cards).values({
              name: name,
              cardNumber: cardNumber,
              setId: set.id,
              frontImageUrl: product.image || null,
              rarity: 'Common',
              estimatedValue: product['loose-price'] ? product['loose-price'].toString() : null
            });
            addedCount++;
          } catch (error) {
            console.error(`    Error adding "${name}": ${error}`);
          }
        }
      }
      
      console.log(`  ✅ Added ${addedCount} new cards`);
      totalAdded += addedCount;
      
      // Progress update every 25 sets
      if ((i + 1) % 25 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n📊 PROGRESS: ${i + 1}/${allSets.length} sets processed`);
        console.log(`📈 Total cards added so far: ${totalAdded}`);
        console.log(`⏱️  Time elapsed: ${Math.floor(elapsed)}s`);
        console.log('-'.repeat(40));
      }
      
      // Wait before next request
      await sleep(DELAY_BETWEEN_REQUESTS);
      
    } catch (error) {
      console.error(`❌ Error processing set "${set.name}": ${error}`);
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }
  
  // Final results
  const finalResult = await db.select().from(cards);
  const finalCount = finalResult.length;
  const elapsed = (Date.now() - startTime) / 1000;
  
  console.log('\n🎉 IMPORT COMPLETE!');
  console.log(`✅ Sets processed: ${allSets.length}`);
  console.log(`✅ Cards added: ${totalAdded}`);
  console.log(`📊 Final card count: ${finalCount}`);
  console.log(`⏱️  Total time: ${Math.floor(elapsed)}s`);
}

processAllSets().catch(console.error);
import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count, and } from 'drizzle-orm';
import fs from 'fs';

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

interface ImportProgress {
  processedSetIds: number[];
  totalNewCards: number;
  lastProcessedIndex: number;
  startTime: string;
  lastUpdate: string;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function saveProgress(progress: ImportProgress) {
  fs.writeFileSync('import-progress.json', JSON.stringify(progress, null, 2));
}

function loadProgress(): ImportProgress | null {
  try {
    if (fs.existsSync('import-progress.json')) {
      return JSON.parse(fs.readFileSync('import-progress.json', 'utf8'));
    }
  } catch (error) {
    console.log('Could not load previous progress:', error.message);
  }
  return null;
}

async function resilientImport() {
  console.log('=== RESILIENT PRICECHARTING IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Load previous progress or start fresh
  let progress = loadProgress();
  const isResume = !!progress;
  
  if (!progress) {
    const [baselineResult] = await db.select({ count: count() }).from(cards);
    progress = {
      processedSetIds: [],
      totalNewCards: 0,
      lastProcessedIndex: -1,
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    };
    console.log(`Starting fresh import. Baseline: ${baselineResult.count} cards`);
  } else {
    console.log(`Resuming import from index ${progress.lastProcessedIndex + 1}`);
    console.log(`Previous progress: ${progress.processedSetIds.length} sets processed, ${progress.totalNewCards} cards added`);
  }

  // Get all sets
  const allSets = await db.select().from(cardSets);
  console.log(`Total sets: ${allSets.length}`);

  // Process sets in batches of 50 to avoid memory issues
  const batchSize = 50;
  let currentBatch = 0;
  
  for (let i = progress.lastProcessedIndex + 1; i < allSets.length; i += batchSize) {
    const batch = allSets.slice(i, Math.min(i + batchSize, allSets.length));
    currentBatch++;
    
    console.log(`\n=== BATCH ${currentBatch} (Sets ${i + 1}-${Math.min(i + batchSize, allSets.length)}) ===`);
    
    for (let j = 0; j < batch.length; j++) {
      const set = batch[j];
      const globalIndex = i + j;
      
      // Skip if already processed
      if (progress.processedSetIds.includes(set.id)) {
        console.log(`[${globalIndex + 1}/${allSets.length}] SKIPPING: "${set.name}" (already processed)`);
        continue;
      }
      
      console.log(`[${globalIndex + 1}/${allSets.length}] Processing: "${set.name}" (ID: ${set.id})`);
      
      try {
        // Get current card count for this set
        const [currentCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
        
        // Format query with dashes
        const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        
        const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(formattedQuery)}&t=${apiKey}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          console.log(`  ❌ API failed: ${response.status}`);
          continue;
        }

        const data: PriceChartingResponse = await response.json();
        const products = data.products || [];
        
        console.log(`  Found ${products.length} products, set has ${currentCardCount.count} cards`);

        // Process products
        let newCardsForSet = 0;
        for (const product of products) {
          const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
          
          if (!match) continue;
          
          const cardName = match[1].trim();
          const cardNumber = match[2].trim();

          // Check if card already exists by name AND number
          const existingCard = await db.select().from(cards)
            .where(and(
              eq(cards.setId, set.id),
              eq(cards.cardNumber, cardNumber),
              eq(cards.name, cardName)
            ))
            .limit(1);

          if (existingCard.length === 0) {
            try {
              const cardSlug = generateSlug(`${cardName}-${cardNumber}`);
              
              await db.insert(cards).values({
                setId: set.id,
                name: cardName,
                cardNumber: cardNumber,
                imageUrl: product.image || '',
                rarity: 'Common',
                variation: '',
                price: product['loose-price'] || 0,
                slug: cardSlug,
                scryfallId: null,
                priceHistory: []
              });
              
              newCardsForSet++;
              progress.totalNewCards++;
              
              if (newCardsForSet <= 3) {
                console.log(`    ✅ Added: "${cardName}" #${cardNumber}`);
              }
            } catch (error) {
              console.log(`    ❌ Error inserting: ${error.message}`);
            }
          }
        }

        console.log(`  📊 Result: ${newCardsForSet} new cards added`);
        
        // Update progress
        progress.processedSetIds.push(set.id);
        progress.lastProcessedIndex = globalIndex;
        progress.lastUpdate = new Date().toISOString();
        
        // Save progress every 10 sets
        if (progress.processedSetIds.length % 10 === 0) {
          saveProgress(progress);
          console.log(`  💾 Progress saved: ${progress.processedSetIds.length} sets processed`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.log(`  ❌ Error processing set: ${error.message}`);
      }
    }
    
    // Save progress after each batch
    saveProgress(progress);
    console.log(`\n💾 Batch ${currentBatch} complete. Total progress: ${progress.processedSetIds.length}/${allSets.length} sets, ${progress.totalNewCards} cards added`);
    
    // Small break between batches
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Final summary
  const [finalResult] = await db.select({ count: count() }).from(cards);
  console.log(`\n=== RESILIENT IMPORT COMPLETE ===`);
  console.log(`Sets processed: ${progress.processedSetIds.length}/${allSets.length}`);
  console.log(`Total new cards added: ${progress.totalNewCards}`);
  console.log(`Final card count: ${finalResult.count}`);
  console.log(`Completion time: ${new Date().toISOString()}`);
  
  // Clean up progress file
  if (fs.existsSync('import-progress.json')) {
    fs.unlinkSync('import-progress.json');
  }
}

resilientImport().catch(console.error);
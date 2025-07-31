import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count, and } from 'drizzle-orm';

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

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Shuffle array function
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function fixedPriceChartingImport() {
  console.log('=== FIXED PRICECHARTING IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  console.log('Starting fixed import with better matching logic...');
  console.log(`Time: ${new Date().toISOString()}`);

  // Get baseline card count
  const [baselineResult] = await db.select({ count: count() }).from(cards);
  const baselineCount = baselineResult.count;
  console.log(`Baseline card count: ${baselineCount}`);

  // Get all sets and randomize order
  const allSets = await db.select().from(cardSets);
  const randomizedSets = shuffleArray(allSets);
  console.log(`Total sets to process: ${randomizedSets.length} (randomized order)`);

  let totalSetsProcessed = 0;
  let totalNewCards = 0;
  let setsWithNewCards = 0;
  let setsWithErrors = 0;

  for (let i = 0; i < randomizedSets.length; i++) {
    const set = randomizedSets[i];
    const setProgress = `[${i+1}/${randomizedSets.length}]`;
    
    console.log(`${setProgress} Processing: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count for this set
    const [currentCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
    console.log(`  Current cards in set: ${currentCardCount.count}`);

    // Format query with dashes (PriceCharting URL format)
    const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    console.log(`  Query: "${formattedQuery}"`);

    try {
      const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(formattedQuery)}&t=${apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.log(`  ❌ API failed: ${response.status} ${response.statusText}`);
        setsWithErrors++;
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      console.log(`  Found ${products.length} products from PriceCharting`);

      if (products.length === 0) {
        console.log(`  ❌ No products found`);
        continue;
      }

      // Log first few products for debugging
      if (products.length > 0) {
        console.log(`  Sample products:`);
        products.slice(0, 3).forEach((product, idx) => {
          console.log(`    ${idx+1}. "${product['product-name']}" (${product['console-name']})`);
        });
      }

      // Process products with BETTER MATCHING LOGIC
      let newCardsForSet = 0;
      for (const product of products) {
        const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
        
        if (!match) {
          continue; // Skip if no card number
        }
        
        const cardName = match[1].trim();
        const cardNumber = match[2].trim();

        // IMPROVED: Check if card already exists by BOTH name AND number
        const existingCard = await db.select().from(cards)
          .where(and(
            eq(cards.setId, set.id),
            eq(cards.cardNumber, cardNumber),
            eq(cards.name, cardName)
          ))
          .limit(1);

        if (existingCard.length === 0) {
          // Insert new card
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
            totalNewCards++;
            
            if (newCardsForSet <= 5) {
              console.log(`    ✅ Added: "${cardName}" #${cardNumber}`);
            }
          } catch (error) {
            console.log(`    ❌ Error inserting card: ${error.message}`);
          }
        }
      }

      console.log(`  📊 Result: ${newCardsForSet} new cards added to set`);
      
      if (newCardsForSet > 0) {
        setsWithNewCards++;
        console.log(`  🎯 SET WITH NEW CARDS: "${set.name}" (+${newCardsForSet})`);
      }

      totalSetsProcessed++;

      // Progress update every 100 sets
      if (i > 0 && i % 100 === 0) {
        const [currentResult] = await db.select({ count: count() }).from(cards);
        const currentCount = currentResult.count;
        console.log(`\n🔄 Progress Update:`);
        console.log(`  Sets processed: ${totalSetsProcessed}/${randomizedSets.length}`);
        console.log(`  New cards so far: ${totalNewCards}`);
        console.log(`  Current total cards: ${currentCount}`);
        console.log(`  Sets with new cards: ${setsWithNewCards}`);
        console.log(`  Sets with errors: ${setsWithErrors}\n`);
      }

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ❌ Error processing set: ${error.message}`);
      setsWithErrors++;
    }
  }

  // Final summary
  console.log(`\n=== FIXED IMPORT COMPLETE ===`);
  console.log(`Sets processed: ${totalSetsProcessed}`);
  console.log(`Sets with new cards: ${setsWithNewCards}`);
  console.log(`Sets with errors: ${setsWithErrors}`);
  console.log(`Total new cards added: ${totalNewCards}`);
  
  // Check final card count
  const [finalResult] = await db.select({ count: count() }).from(cards);
  const finalCount = finalResult.count;
  console.log(`Final card count: ${finalCount} (was ${baselineCount})`);
  console.log(`Net cards added: ${finalCount - baselineCount}`);
  console.log(`Completion time: ${new Date().toISOString()}`);

  if (totalNewCards > 0) {
    console.log(`\n✅ SUCCESS: Added ${totalNewCards} new cards from PriceCharting!`);
  } else {
    console.log(`\n❌ No new cards added - need to investigate further`);
  }
}

fixedPriceChartingImport().catch(console.error);
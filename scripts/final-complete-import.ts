import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count } from 'drizzle-orm';
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

function parseCardName(fullName: string): { cardName: string; cardNumber: string } {
  const match = fullName.match(/^(.+?)\s+#([A-Z0-9-]+)$/);
  if (match) {
    return { cardName: match[1].trim(), cardNumber: match[2].trim() };
  }
  return { cardName: fullName.trim(), cardNumber: '' };
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function finalCompleteImport() {
  console.log('=== FINAL COMPLETE PRICECHARTING IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Log file
  const logFile = 'final-import-results.log';
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  
  function log(message: string) {
    console.log(message);
    logStream.write(message + '\n');
  }

  log('Starting final complete import...');
  log(`API Key present: ${apiKey ? 'YES' : 'NO'}`);
  log(`Time: ${new Date().toISOString()}`);

  // Get baseline card count
  const [baselineResult] = await db.select({ count: count() }).from(cards);
  const baselineCount = baselineResult.count;
  log(`Baseline card count: ${baselineCount}`);

  // Get all sets
  const allSets = await db.select().from(cardSets);
  log(`Total sets to process: ${allSets.length}`);

  let totalSetsProcessed = 0;
  let totalNewCards = 0;
  let setsWithNewCards = 0;
  let setsWithErrors = 0;

  for (let i = 0; i < allSets.length; i++) {
    const set = allSets[i];
    const setProgress = `[${i+1}/${allSets.length}]`;
    
    log(`${setProgress} Processing: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count for this set
    const [currentCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
    log(`  Current cards in set: ${currentCardCount.count}`);

    // Format query with dashes (PriceCharting URL format)
    const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    log(`  Query: "${formattedQuery}"`);

    try {
      const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(formattedQuery)}&t=${apiKey}`;
      log(`  URL: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        log(`  ❌ API failed: ${response.status} ${response.statusText}`);
        setsWithErrors++;
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      log(`  Found ${products.length} products from PriceCharting`);

      if (products.length === 0) {
        log(`  ❌ No products found for this query`);
        continue;
      }

      // Log first few products for debugging
      if (products.length > 0) {
        log(`  Sample products:`);
        products.slice(0, 3).forEach((product, idx) => {
          log(`    ${idx+1}. "${product['product-name']}" (${product['console-name']})`);
        });
      }

      // Process products
      let newCardsForSet = 0;
      for (const product of products) {
        const parsed = parseCardName(product['product-name']);
        
        if (!parsed.cardNumber) {
          continue; // Skip if no card number
        }

        // Check if card already exists
        const existingCard = await db.select().from(cards)
          .where(eq(cards.setId, set.id))
          .where(eq(cards.cardNumber, parsed.cardNumber))
          .limit(1);

        if (existingCard.length === 0) {
          // Insert new card
          try {
            const cardSlug = generateSlug(`${parsed.cardName}-${parsed.cardNumber}`);
            
            await db.insert(cards).values({
              setId: set.id,
              name: parsed.cardName,
              cardNumber: parsed.cardNumber,
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
              log(`    ✅ Added: "${parsed.cardName}" #${parsed.cardNumber}`);
            }
          } catch (error) {
            log(`    ❌ Error inserting card: ${error.message}`);
          }
        }
      }

      log(`  📊 Result: ${newCardsForSet} new cards added to set`);
      
      if (newCardsForSet > 0) {
        setsWithNewCards++;
      }

      totalSetsProcessed++;

      // Progress update every 50 sets
      if (i > 0 && i % 50 === 0) {
        const [currentResult] = await db.select({ count: count() }).from(cards);
        const currentCount = currentResult.count;
        log(`\n🔄 Progress Update:`);
        log(`  Sets processed: ${totalSetsProcessed}/${allSets.length}`);
        log(`  New cards so far: ${totalNewCards}`);
        log(`  Current total cards: ${currentCount}`);
        log(`  Sets with new cards: ${setsWithNewCards}`);
        log(`  Sets with errors: ${setsWithErrors}\n`);
      }

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      log(`  ❌ Error processing set: ${error.message}`);
      setsWithErrors++;
    }
  }

  // Final summary
  log(`\n=== FINAL IMPORT COMPLETE ===`);
  log(`Sets processed: ${totalSetsProcessed}`);
  log(`Sets with new cards: ${setsWithNewCards}`);
  log(`Sets with errors: ${setsWithErrors}`);
  log(`Total new cards added: ${totalNewCards}`);
  
  // Check final card count
  const [finalResult] = await db.select({ count: count() }).from(cards);
  const finalCount = finalResult.count;
  log(`Final card count: ${finalCount} (was ${baselineCount})`);
  log(`Net cards added: ${finalCount - baselineCount}`);
  log(`Completion time: ${new Date().toISOString()}`);

  logStream.end();
  
  if (totalNewCards === 0) {
    log(`\n❌ RESULT: No new cards were added`);
    log(`This suggests your database already contains all cards available in PriceCharting`);
  } else {
    log(`\n✅ RESULT: Successfully added ${totalNewCards} new cards from PriceCharting`);
  }
}

finalCompleteImport().catch(console.error);
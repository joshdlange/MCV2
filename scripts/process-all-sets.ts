import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count } from 'drizzle-orm';

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

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processAllSets() {
  console.log('=== PROCESSING ALL SETS WITHOUT STOPPING ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  console.log('Getting all sets from database...');
  const allSets = await db.select().from(cardSets).orderBy(cardSets.id);
  console.log(`Found ${allSets.length} sets total`);

  // Get baseline card count
  const [baselineResult] = await db.select({ count: count() }).from(cards);
  const baselineCount = baselineResult.count;
  console.log(`Starting with ${baselineCount} cards`);

  let totalNewCards = 0;
  let setsProcessed = 0;
  let setsWithNewCards = 0;
  let setsWithErrors = 0;

  for (let i = 0; i < allSets.length; i++) {
    const set = allSets[i];
    const progress = `[${i + 1}/${allSets.length}]`;
    
    console.log(`\n${progress} Processing: "${set.name}" (ID: ${set.id})`);
    
    try {
      // Get current card count for this set
      const [currentResult] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
      const currentCount = currentResult.count;
      console.log(`  Current cards: ${currentCount}`);

      // Format query for PriceCharting API
      const query = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      console.log(`  Query: "${query}"`);

      let response;
      let attempts = 0;
      const maxAttempts = 3;

      // Retry logic for API calls
      while (attempts < maxAttempts) {
        try {
          const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`;
          
          response = await fetch(url, {
            headers: {
              'User-Agent': 'Marvel Card Vault Import',
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            break;
          } else {
            console.log(`  API error ${response.status}, retrying...`);
            attempts++;
            await sleep(3000);
          }
        } catch (error) {
          console.log(`  Network error: ${error}, retrying...`);
          attempts++;
          await sleep(3000);
        }
      }

      if (!response || !response.ok) {
        console.log(`  Failed after ${maxAttempts} attempts, skipping`);
        setsWithErrors++;
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      console.log(`  Found ${data.products.length} products`);

      if (data.products.length === 0) {
        console.log(`  No products found, continuing`);
        continue;
      }

      // Get existing cards for this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardKeys = new Set();
      
      for (const card of existingCards) {
        existingCardKeys.add(`${card.name.toLowerCase()}::${card.cardNumber}`);
        existingCardKeys.add(card.name.toLowerCase());
        existingCardKeys.add(card.cardNumber);
      }

      let newCardsForSet = 0;

      // Process each product
      for (const product of data.products) {
        const productName = product['product-name'];
        const consoleName = product['console-name'];
        
        // Only process Marvel cards
        if (!consoleName.toLowerCase().includes('marvel')) {
          continue;
        }

        // Extract card number and name
        let cardNumber = '';
        let cardName = productName;
        
        const numberMatch = productName.match(/#([A-Z0-9-]+)/i);
        if (numberMatch) {
          cardNumber = numberMatch[1];
          cardName = productName.replace(/#[A-Z0-9-]+/i, '').trim();
        }

        // Clean up card name
        cardName = cardName.replace(/\[.*?\]/g, '').trim();

        // Check if card already exists
        const cardKeys = [
          `${cardName.toLowerCase()}::${cardNumber}`,
          cardName.toLowerCase(),
          cardNumber,
        ];

        let exists = false;
        for (const key of cardKeys) {
          if (existingCardKeys.has(key)) {
            exists = true;
            break;
          }
        }

        if (exists) {
          continue;
        }

        // Add new card
        try {
          await db.insert(cards).values({
            setId: set.id,
            cardNumber: cardNumber || `PC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: cardName,
            variation: null,
            rarity: 'Common',
            isInsert: false,
            description: `Imported from PriceCharting: ${consoleName}`,
            frontImageUrl: product.image || null,
            backImageUrl: null,
            estimatedValue: product['loose-price'] || null,
          });

          console.log(`    ✅ Added: "${cardName}" #${cardNumber}`);
          newCardsForSet++;
          totalNewCards++;
          
          // Add to existing set to prevent duplicates
          existingCardKeys.add(`${cardName.toLowerCase()}::${cardNumber}`);
          
        } catch (error) {
          console.log(`    ❌ Failed to add "${cardName}": ${error}`);
        }
      }

      if (newCardsForSet > 0) {
        console.log(`  🎯 Added ${newCardsForSet} new cards to set`);
        setsWithNewCards++;
      }

      setsProcessed++;

      // Status update every 10 sets
      if (setsProcessed % 10 === 0) {
        console.log(`\n--- STATUS UPDATE ---`);
        console.log(`Sets processed: ${setsProcessed}/${allSets.length}`);
        console.log(`Sets with new cards: ${setsWithNewCards}`);
        console.log(`Total new cards: ${totalNewCards}`);
        console.log(`Sets with errors: ${setsWithErrors}`);
        console.log(`-------------------\n`);
      }

      // Rate limiting
      await sleep(2000);

    } catch (error) {
      console.log(`  ❌ Error processing set: ${error}`);
      setsWithErrors++;
    }
  }

  // Final results
  const [finalResult] = await db.select({ count: count() }).from(cards);
  const finalCount = finalResult.count;
  
  console.log('\n=== FINAL RESULTS ===');
  console.log(`Cards before: ${baselineCount}`);
  console.log(`Cards after: ${finalCount}`);
  console.log(`New cards added: ${totalNewCards}`);
  console.log(`Sets processed: ${setsProcessed}/${allSets.length}`);
  console.log(`Sets with new cards: ${setsWithNewCards}`);
  console.log(`Sets with errors: ${setsWithErrors}`);
  console.log(`Success rate: ${((setsProcessed / allSets.length) * 100).toFixed(1)}%`);
  console.log('===================');
}

// Run the import
processAllSets().catch(console.error);
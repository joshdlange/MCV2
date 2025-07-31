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

async function simpleCompleteImport() {
  console.log('=== SIMPLE COMPLETE IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    console.error('Missing PRICECHARTING_API_TOKEN');
    return;
  }

  console.log('Getting all sets...');
  const allSets = await db.select().from(cardSets).orderBy(cardSets.id);
  console.log(`Total sets: ${allSets.length}`);

  // Get baseline
  const [baselineResult] = await db.select({ count: count() }).from(cards);
  const baselineCount = baselineResult.count;
  console.log(`Starting cards: ${baselineCount}`);

  let totalNewCards = 0;
  let setsProcessed = 0;
  let setsWithNewCards = 0;

  // Process each set
  for (let i = 0; i < allSets.length; i++) {
    const set = allSets[i];
    console.log(`\n[${i + 1}/${allSets.length}] "${set.name}" (ID: ${set.id})`);
    
    try {
      // Get existing cards in this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingKeys = new Set<string>();
      
      existingCards.forEach(card => {
        existingKeys.add(`${card.name.toLowerCase()}||${card.cardNumber}`);
        existingKeys.add(card.name.toLowerCase());
      });
      
      console.log(`  Existing cards: ${existingCards.length}`);

      // Format query for API
      const query = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`;
      
      console.log(`  Querying: ${query}`);

      // Make API call
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Marvel Card Vault',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`  API error: ${response.status}, skipping`);
        await sleep(1000);
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      console.log(`  Found ${data.products.length} products`);

      if (data.products.length === 0) {
        console.log(`  No products, continuing`);
        setsProcessed++;
        await sleep(500);
        continue;
      }

      let newCardsThisSet = 0;

      // Process each product
      for (const product of data.products) {
        const productName = product['product-name'];
        const consoleName = product['console-name'];
        
        // Only Marvel cards
        if (!consoleName.toLowerCase().includes('marvel')) {
          continue;
        }

        // Parse card info
        let cardNumber = '';
        let cardName = productName;
        
        const numberMatch = productName.match(/#([A-Z0-9-]+)/i);
        if (numberMatch) {
          cardNumber = numberMatch[1];
          cardName = productName.replace(/#[A-Z0-9-]+/i, '').trim();
        }

        cardName = cardName.replace(/\[.*?\]/g, '').trim();

        // Check if exists
        const cardKey = `${cardName.toLowerCase()}||${cardNumber}`;
        if (existingKeys.has(cardKey) || existingKeys.has(cardName.toLowerCase())) {
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
            description: `Imported from PriceCharting`,
            frontImageUrl: product.image || null,
            backImageUrl: null,
            estimatedValue: product['loose-price'] || null,
          });

          newCardsThisSet++;
          totalNewCards++;
          existingKeys.add(cardKey);
          
        } catch (error) {
          // Skip duplicate errors
        }
      }

      if (newCardsThisSet > 0) {
        console.log(`  ✅ Added ${newCardsThisSet} new cards`);
        setsWithNewCards++;
      } else {
        console.log(`  No new cards added`);
      }

      setsProcessed++;

      // Progress update
      if (setsProcessed % 25 === 0) {
        console.log(`\n--- PROGRESS: ${setsProcessed}/${allSets.length} sets ---`);
        console.log(`New cards so far: ${totalNewCards}`);
        console.log(`Sets with new cards: ${setsWithNewCards}`);
        console.log(`Success rate: ${((setsProcessed / allSets.length) * 100).toFixed(1)}%`);
      }

      // Rate limiting
      await sleep(1500);

    } catch (error) {
      console.log(`  Error: ${error}`);
      await sleep(1000);
    }
  }

  // Final count
  const [finalResult] = await db.select({ count: count() }).from(cards);
  const finalCount = finalResult.count;
  
  console.log('\n=== FINAL RESULTS ===');
  console.log(`Starting cards: ${baselineCount}`);
  console.log(`Final cards: ${finalCount}`);
  console.log(`New cards added: ${finalCount - baselineCount}`);
  console.log(`Sets processed: ${setsProcessed}/${allSets.length}`);
  console.log(`Sets with new cards: ${setsWithNewCards}`);
  console.log(`==================`);
}

simpleCompleteImport().catch(console.error);
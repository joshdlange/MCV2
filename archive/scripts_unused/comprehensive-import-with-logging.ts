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

function parseCardName(fullName: string): { cardName: string; cardNumber: string } {
  const match = fullName.match(/^(.+?)\s+#([A-Z0-9-]+)$/);
  if (match) {
    return { cardName: match[1].trim(), cardNumber: match[2].trim() };
  }
  return { cardName: fullName.trim(), cardNumber: '' };
}

async function comprehensiveImport() {
  console.log('=== COMPREHENSIVE PRICECHARTING IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get baseline card count
  const [baselineResult] = await db.select({ count: count() }).from(cards);
  const baselineCount = baselineResult.count;
  console.log(`Baseline card count: ${baselineCount}`);

  // Get all sets
  const allSets = await db.select().from(cardSets);
  console.log(`Processing ${allSets.length} sets`);

  let totalSetsProcessed = 0;
  let totalNewCards = 0;
  let setsWithNewCards = 0;
  const results = [];

  for (let i = 0; i < allSets.length; i++) {
    const set = allSets[i];
    console.log(`\n[${i+1}/${allSets.length}] Processing: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count for this set
    const [currentCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
    console.log(`  Current cards in set: ${currentCardCount.count}`);

    // Format query
    const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-');
    console.log(`  Query: "${formattedQuery}"`);

    try {
      const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${formattedQuery}&t=${apiKey}`);
      
      if (!response.ok) {
        console.log(`  ❌ API failed: ${response.status}`);
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      console.log(`  Found ${products.length} products from PriceCharting`);

      if (products.length === 0) {
        console.log(`  ❌ No products found`);
        continue;
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
            await db.insert(cards).values({
              setId: set.id,
              name: parsed.cardName,
              cardNumber: parsed.cardNumber,
              imageUrl: product.image || '',
              rarity: 'Common',
              variation: '',
              price: product['loose-price'] || 0,
              slug: `${parsed.cardName.toLowerCase().replace(/\s+/g, '-')}-${parsed.cardNumber}`,
              scryfallId: null,
              priceHistory: []
            });
            
            newCardsForSet++;
            totalNewCards++;
            
            if (newCardsForSet <= 3) {
              console.log(`    ✅ Added: "${parsed.cardName}" #${parsed.cardNumber}`);
            }
          } catch (error) {
            console.log(`    ❌ Error inserting card: ${error.message}`);
          }
        }
      }

      console.log(`  📊 Result: ${newCardsForSet} new cards added to set`);
      
      if (newCardsForSet > 0) {
        setsWithNewCards++;
      }

      results.push({
        setName: set.name,
        currentCards: currentCardCount.count,
        productsFound: products.length,
        newCards: newCardsForSet
      });

      totalSetsProcessed++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ❌ Error processing set: ${error.message}`);
    }
  }

  // Final summary
  console.log(`\n=== COMPREHENSIVE IMPORT COMPLETE ===`);
  console.log(`Sets processed: ${totalSetsProcessed}`);
  console.log(`Sets with new cards: ${setsWithNewCards}`);
  console.log(`Total new cards added: ${totalNewCards}`);
  
  // Check final card count
  const [finalResult] = await db.select({ count: count() }).from(cards);
  const finalCount = finalResult.count;
  console.log(`Final card count: ${finalCount} (was ${baselineCount})`);
  console.log(`Net cards added: ${finalCount - baselineCount}`);

  // Show top results
  const topResults = results
    .filter(r => r.newCards > 0)
    .sort((a, b) => b.newCards - a.newCards)
    .slice(0, 10);

  if (topResults.length > 0) {
    console.log(`\n🎯 Top 10 sets with new cards:`);
    topResults.forEach((result, i) => {
      console.log(`${i+1}. "${result.setName}": +${result.newCards} cards`);
    });
  } else {
    console.log(`\n❌ No new cards were added - all PriceCharting cards already exist`);
  }
}

comprehensiveImport().catch(console.error);
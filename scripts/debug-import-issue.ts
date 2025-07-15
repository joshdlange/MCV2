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

async function debugImportIssue() {
  console.log('=== DEBUGGING IMPORT ISSUE ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    console.log('❌ No API key found');
    return;
  }
  
  // Find sets with very few cards that should have more
  const smallSets = await db.select().from(cardSets).limit(20);
  
  for (const set of smallSets) {
    const [cardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
    
    if (cardCount.count < 20) {
      console.log(`\n🔍 Testing set: "${set.name}" (${cardCount.count} cards)`);
      
      // Format query
      const query = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      console.log(`  Query: "${query}"`);
      
      try {
        const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`);
        
        if (!response.ok) {
          console.log(`  ❌ API failed: ${response.status}`);
          continue;
        }
        
        const data: PriceChartingResponse = await response.json();
        const products = data.products || [];
        
        console.log(`  Found ${products.length} products`);
        
        if (products.length > 0) {
          console.log(`  Sample products:`);
          products.slice(0, 3).forEach((product, i) => {
            console.log(`    ${i+1}. "${product['product-name']}" (${product['console-name']})`);
          });
          
          // Check if any would be new
          let potentialNewCards = 0;
          for (const product of products) {
            const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
            if (match) {
              const cardNumber = match[2];
              const existingCard = await db.select().from(cards)
                .where(eq(cards.setId, set.id))
                .where(eq(cards.cardNumber, cardNumber))
                .limit(1);
              
              if (existingCard.length === 0) {
                potentialNewCards++;
                if (potentialNewCards <= 3) {
                  console.log(`    🆕 New card: "${match[1]}" #${cardNumber}`);
                }
              }
            }
          }
          
          console.log(`  💡 Potential new cards: ${potentialNewCards}`);
          
          if (potentialNewCards > 0) {
            console.log(`  ⚠️  THIS SET SHOULD HAVE NEW CARDS!`);
            
            // Try to insert one card to test
            const firstNewProduct = products.find(p => {
              const match = p['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
              if (match) {
                const cardNumber = match[2];
                return db.select().from(cards)
                  .where(eq(cards.setId, set.id))
                  .where(eq(cards.cardNumber, cardNumber))
                  .limit(1)
                  .then(existing => existing.length === 0);
              }
              return false;
            });
            
            if (firstNewProduct) {
              const match = firstNewProduct['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
              if (match) {
                console.log(`  🔧 Attempting to insert test card: "${match[1]}" #${match[2]}`);
                
                try {
                  await db.insert(cards).values({
                    setId: set.id,
                    name: match[1].trim(),
                    cardNumber: match[2].trim(),
                    imageUrl: firstNewProduct.image || '',
                    rarity: 'Common',
                    variation: '',
                    price: firstNewProduct['loose-price'] || 0,
                    slug: `${match[1].toLowerCase().replace(/\s+/g, '-')}-${match[2]}`,
                    scryfallId: null,
                    priceHistory: []
                  });
                  
                  console.log(`  ✅ Successfully inserted test card!`);
                  
                  // Check new card count
                  const [newCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
                  console.log(`  📊 Set now has ${newCardCount.count} cards (was ${cardCount.count})`);
                  
                  return; // Exit after successful test
                } catch (error) {
                  console.log(`  ❌ Failed to insert card: ${error.message}`);
                }
              }
            }
          }
        }
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n=== DEBUG COMPLETE ===');
}

debugImportIssue().catch(console.error);
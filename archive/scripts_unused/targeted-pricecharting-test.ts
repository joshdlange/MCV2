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

async function targetedPriceChartingTest() {
  console.log('=== TARGETED PRICECHARTING TEST ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Find sets with fewer than 50 cards (potential targets for missing cards)
  const allSets = await db.select().from(cardSets).limit(100);
  const setsWithFewCards = [];
  
  for (const set of allSets) {
    const [cardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
    if (cardCount.count < 50) {
      setsWithFewCards.push({
        id: set.id,
        name: set.name,
        currentCards: cardCount.count
      });
    }
  }
  
  console.log(`Found ${setsWithFewCards.length} sets with fewer than 50 cards`);
  
  // Test first 10 sets with few cards
  for (let i = 0; i < Math.min(10, setsWithFewCards.length); i++) {
    const set = setsWithFewCards[i];
    console.log(`\n[${i+1}/10] Testing set: "${set.name}" (${set.currentCards} cards)`);
    
    const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-');
    console.log(`Query: "${formattedQuery}"`);
    
    try {
      const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${formattedQuery}&t=${apiKey}`);
      
      if (!response.ok) {
        console.log(`❌ API failed: ${response.status}`);
        continue;
      }
      
      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      console.log(`Found ${products.length} products from PriceCharting`);
      
      if (products.length === 0) {
        console.log(`❌ No products found`);
        continue;
      }
      
      // Check how many would be new
      let newCards = 0;
      for (const product of products.slice(0, 20)) {
        const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
        if (match) {
          const [, cardName, cardNumber] = match;
          
          const existingCard = await db.select().from(cards)
            .where(eq(cards.setId, set.id))
            .where(eq(cards.cardNumber, cardNumber))
            .limit(1);
          
          if (existingCard.length === 0) {
            newCards++;
            if (newCards <= 3) {
              console.log(`  🆕 New card: "${cardName}" #${cardNumber}`);
            }
          }
        }
      }
      
      console.log(`🎯 Potential new cards: ${newCards}`);
      
      if (newCards > 0) {
        console.log(`✅ SET "${set.name}" HAS ${newCards} NEW CARDS TO IMPORT`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n=== TARGETED TEST COMPLETE ===');
}

targetedPriceChartingTest().catch(console.error);
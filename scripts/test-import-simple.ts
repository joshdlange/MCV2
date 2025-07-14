import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

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

async function testImportSimple() {
  console.log('=== TESTING SIMPLE IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get first 5 sets to test
  const testSets = await db.select().from(cardSets).limit(5);
  console.log(`Testing ${testSets.length} sets:`);
  
  for (let i = 0; i < testSets.length; i++) {
    const set = testSets[i];
    console.log(`\n[${i+1}/5] Testing set: "${set.name}" (ID: ${set.id})`);
    
    // Format query
    const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-');
    console.log(`Query: "${formattedQuery}"`);
    
    try {
      // Make API call
      const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${formattedQuery}&t=${apiKey}`);
      
      if (!response.ok) {
        console.log(`❌ API call failed: ${response.status}`);
        continue;
      }
      
      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      console.log(`Found ${products.length} products from PriceCharting`);
      
      if (products.length === 0) {
        console.log(`❌ No products found for "${set.name}"`);
        continue;
      }
      
      // Show first few products
      console.log(`Sample products:`);
      products.slice(0, 3).forEach((product, index) => {
        console.log(`  ${index + 1}. "${product['product-name']}" (${product['console-name']})`);
      });
      
      // Check current cards in this set
      const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      console.log(`Current cards in database for this set: ${currentCards.length}`);
      
      // Look for products that could be new cards
      let potentialNewCards = 0;
      for (const product of products.slice(0, 5)) { // Check first 5 products
        const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
        if (match) {
          const [, cardName, cardNumber] = match;
          
          // Check if this card exists
          const existingCard = await db.select().from(cards)
            .where(eq(cards.setId, set.id))
            .where(eq(cards.cardNumber, cardNumber))
            .limit(1);
          
          if (existingCard.length === 0) {
            console.log(`  🆕 Potential new card: "${cardName}" #${cardNumber}`);
            potentialNewCards++;
          }
        }
      }
      
      console.log(`Potential new cards found: ${potentialNewCards}`);
      
    } catch (error) {
      console.log(`❌ Error processing set: ${error.message}`);
    }
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n=== SIMPLE IMPORT TEST COMPLETE ===');
}

testImportSimple().catch(console.error);
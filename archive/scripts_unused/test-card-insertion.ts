import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count } from 'drizzle-orm';

async function testCardInsertion() {
  console.log('=== TESTING CARD INSERTION ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    console.log('❌ No API key found');
    return;
  }
  
  // Find a set with very few cards
  const testSet = await db.select().from(cardSets).where(eq(cardSets.id, 1474)).limit(1);
  if (testSet.length === 0) {
    console.log('❌ Test set not found');
    return;
  }
  
  const set = testSet[0];
  console.log(`Testing set: "${set.name}" (ID: ${set.id})`);
  
  // Get current cards
  const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
  console.log(`Current cards in set: ${currentCards.length}`);
  currentCards.forEach((card, i) => {
    console.log(`  ${i+1}. "${card.name}" #${card.cardNumber}`);
  });
  
  // Get PriceCharting products
  const query = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  console.log(`Query: "${query}"`);
  
  const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`);
  const data = await response.json();
  
  console.log(`Found ${data.products?.length || 0} products from PriceCharting`);
  
  if (data.products?.length > 0) {
    console.log('PriceCharting products:');
    data.products.forEach((product, i) => {
      console.log(`  ${i+1}. "${product['product-name']}" (${product['console-name']})`);
    });
    
    // Check each product
    for (const product of data.products) {
      const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
      if (match) {
        const cardName = match[1].trim();
        const cardNumber = match[2].trim();
        
        console.log(`\nChecking: "${cardName}" #${cardNumber}`);
        
        // Check if exists
        const existingCard = await db.select().from(cards)
          .where(eq(cards.setId, set.id))
          .where(eq(cards.cardNumber, cardNumber))
          .limit(1);
        
        if (existingCard.length === 0) {
          console.log(`  ✅ This card doesn't exist - should be inserted!`);
          
          // Try to insert
          try {
            const result = await db.insert(cards).values({
              setId: set.id,
              name: cardName,
              cardNumber: cardNumber,
              imageUrl: product.image || '',
              rarity: 'Common',
              variation: '',
              price: product['loose-price'] || 0,
              slug: `${cardName.toLowerCase().replace(/\s+/g, '-')}-${cardNumber}`,
              scryfallId: null,
              priceHistory: []
            });
            
            console.log(`  🎉 Successfully inserted card!`);
            
            // Verify insertion
            const [newCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
            console.log(`  📊 Set now has ${newCount.count} cards`);
            
            return; // Exit after successful insertion
          } catch (error) {
            console.log(`  ❌ Failed to insert: ${error.message}`);
          }
        } else {
          console.log(`  ⚠️  Card already exists: "${existingCard[0].name}" #${existingCard[0].cardNumber}`);
        }
      } else {
        console.log(`  ⚠️  No card number found in: "${product['product-name']}"`);
      }
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

testCardInsertion().catch(console.error);
import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function testSingleSetInsert() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  console.log('Testing single set insert...');
  
  // Get specific set
  const allSets = await db.select().from(cardSets).limit(10);
  const set = allSets[5]; // 1995 fleer dc vs marvel impact
  
  console.log(`Testing set: "${set.name}" (ID: ${set.id})`);
  
  // Query PriceCharting
  const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(set.name)}&t=${apiKey}`;
  console.log(`API Call: ${apiUrl.replace(apiKey, 'HIDDEN_KEY')}`);
  
  const response = await fetch(apiUrl);
  const data = await response.json();
  const products = data.products || [];
  
  console.log(`Found ${products.length} products`);
  
  // Process first product
  const firstProduct = products[0];
  console.log(`Processing: "${firstProduct['product-name']}"`);
  
  // Parse card name
  const match = firstProduct['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
  if (match) {
    const [, cardName, cardNumber] = match;
    console.log(`Parsed: Card="${cardName}", Number="${cardNumber}"`);
    
    // Check if exists
    const existing = await db.select().from(cards)
      .where(eq(cards.setId, set.id))
      .where(eq(cards.cardNumber, cardNumber))
      .limit(1);
    
    if (existing.length > 0) {
      console.log(`Card already exists: ${cardNumber}`);
    } else {
      console.log(`Card does not exist - inserting...`);
      
      // Insert card
      await db.insert(cards).values({
        setId: set.id,
        cardNumber: cardNumber,
        name: cardName,
        frontImageUrl: firstProduct.image || null,
        estimatedValue: firstProduct['loose-price'] ? firstProduct['loose-price'].toString() : null,
        rarity: 'Common',
        variation: null,
        isInsert: false,
        backImageUrl: null,
        description: null,
        createdAt: new Date()
      });
      
      console.log(`✅ Successfully inserted: "${cardName}" #${cardNumber}`);
    }
  }
}

testSingleSetInsert().catch(console.error);

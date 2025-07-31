import { db } from './server/db';
import { cardSets, cards } from './shared/schema';
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

async function debugImportIssue() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get the What If set
  const sets = await db.select().from(cardSets).where(eq(cardSets.name, 'marvel 2020 masterpieces What If...'));
  const set = sets[0];
  
  if (!set) {
    console.log('Set not found');
    return;
  }

  console.log(`Debugging set: "${set.name}" (ID: ${set.id})`);
  
  // Check how many cards we have in database
  const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
  console.log(`Cards in database: ${existingCards.length}`);
  
  // Show first 5 existing cards
  console.log('First 5 existing cards:');
  existingCards.slice(0, 5).forEach(card => {
    console.log(`  - "${card.name}" #${card.cardNumber}`);
  });

  // Query PriceCharting for this set
  const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(set.name)}&t=${apiKey}`;
  console.log(`\nAPI Call: ${apiUrl.replace(apiKey, 'HIDDEN_KEY')}`);
  
  const response = await fetch(apiUrl);
  const data: PriceChartingResponse = await response.json();
  const products = data.products || [];
  
  console.log(`\nPriceCharting found: ${products.length} products`);
  
  // Show first 10 products from PriceCharting
  console.log('First 10 products from PriceCharting:');
  products.slice(0, 10).forEach((product, index) => {
    console.log(`  ${index + 1}. "${product['product-name']}" (Console: ${product['console-name']})`);
  });

  // Check if we can find any missing cards
  let missingCards = 0;
  let duplicateCards = 0;
  
  for (const product of products.slice(0, 10)) {
    // Parse card name
    const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
    if (match) {
      const [, cardName, cardNumber] = match;
      
      // Check if card exists
      const existing = await db.select().from(cards)
        .where(eq(cards.setId, set.id))
        .where(eq(cards.cardNumber, cardNumber))
        .limit(1);
      
      if (existing.length > 0) {
        duplicateCards++;
        console.log(`  DUPLICATE: Card #${cardNumber} already exists`);
      } else {
        missingCards++;
        console.log(`  MISSING: Card #${cardNumber} "${cardName}" NOT found in database`);
      }
    }
  }
  
  console.log(`\nSummary for first 10 products:`);
  console.log(`Missing cards: ${missingCards}`);
  console.log(`Duplicate cards: ${duplicateCards}`);
  
  if (missingCards > 0) {
    console.log('\n🚨 PROBLEM FOUND: There are missing cards that should be added!');
  } else {
    console.log('\n✅ All cards already exist (as expected)');
  }
}

debugImportIssue().catch(console.error);
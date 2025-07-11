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

// Parse card name into components
function parseCardName(fullName: string): { setName: string; cardNumber: string; cardName: string } {
  // Pattern 1: "Card Name #Number" (e.g. "Colossus #64")
  const match1 = fullName.match(/^(.+?)\s+#(\d+(?:\w+)?)$/);
  if (match1) {
    const [, cardName, cardNumber] = match1;
    return {
      setName: '',
      cardNumber: cardNumber.trim(),
      cardName: cardName.trim()
    };
  }
  
  // Pattern 2: "Set Name #Number Card Name" (e.g. "1992 Marvel Masterpieces #15 Spider-Man")
  const match2 = fullName.match(/^(.+?)\s+#(\d+(?:\w+)?)\s+(.+)$/);
  if (match2) {
    const [, setName, cardNumber, cardName] = match2;
    return {
      setName: setName.trim(),
      cardNumber: cardNumber.trim(),
      cardName: cardName.trim()
    };
  }
  
  // Fallback: if no card number pattern found
  return {
    setName: fullName.trim(),
    cardNumber: '',
    cardName: fullName.trim()
  };
}

// Test with single set
async function testSingleSet() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  console.log('Testing PriceCharting import with single set...');
  
  try {
    // Get a different set from database
    const allSets = await db.select().from(cardSets).limit(10);
    const set = allSets[5]; // Try 6th set instead of first
    
    console.log(`\nTesting set: "${set.name}" (ID: ${set.id})`);
    
    // Query PriceCharting specifically for this set
    const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(set.name)}&t=${apiKey}`;
    console.log(`API Call: ${apiUrl.replace(apiKey, 'HIDDEN_KEY')}`);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data: PriceChartingResponse = await response.json();
    const products = data.products || [];
    console.log(`Found ${products.length} products for set "${set.name}"`);
    
    if (products.length === 0) {
      console.log('No products found for this set');
      return;
    }
    
    // Show first few products
    console.log('\nFirst 5 products found:');
    products.slice(0, 5).forEach((product, index) => {
      console.log(`${index + 1}. "${product['product-name']}" (Console: ${product['console-name']})`);
    });
    
    // These are already trading cards since we queried platform=trading-card
    // Just filter out obvious non-cards
    const tradingCards = products.filter(product => {
      const consoleName = product['console-name']?.toLowerCase() || '';
      const productName = product['product-name']?.toLowerCase() || '';
      
      // Skip video games, toys, etc.
      return !consoleName.includes('video') && 
             !consoleName.includes('game') && 
             !consoleName.includes('toy') &&
             !productName.includes('video') &&
             !productName.includes('game');
    });
    
    console.log(`\nFiltered to ${tradingCards.length} trading card products`);
    
    if (tradingCards.length === 0) {
      console.log('No trading cards found for this set');
      return;
    }
    
    // Process first trading card
    const firstCard = tradingCards[0];
    console.log(`\nProcessing first trading card: "${firstCard['product-name']}"`);
    
    const parsed = parseCardName(firstCard['product-name']);
    console.log(`Parsed -> Card: "${parsed.cardName}", Number: "${parsed.cardNumber}"`);
    
    // Check if card already exists
    const existingCard = await db
      .select()
      .from(cards)
      .where(eq(cards.setId, set.id))
      .where(eq(cards.cardNumber, parsed.cardNumber))
      .limit(1);
    
    if (existingCard.length > 0) {
      console.log(`Card already exists in set: ${parsed.cardNumber}`);
    } else {
      console.log(`Card does not exist - would insert: "${parsed.cardName}" #${parsed.cardNumber}`);
      
      // Actually insert the card
      await db.insert(cards).values({
        setId: set.id,
        cardNumber: parsed.cardNumber,
        name: parsed.cardName,
        frontImageUrl: firstCard.image || null,
        estimatedValue: firstCard['loose-price'] ? firstCard['loose-price'].toString() : null,
        rarity: 'Common',
        variation: null,
        isInsert: false,
        backImageUrl: null,
        description: null,
        createdAt: new Date()
      });
      
      console.log(`✅ Successfully inserted card: "${parsed.cardName}" #${parsed.cardNumber}`);
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testSingleSet().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Calculate similarity between two strings using Levenshtein distance
function calculateSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(null));
  
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  const maxLength = Math.max(len1, len2);
  return maxLength === 0 ? 1 : (maxLength - matrix[len1][len2]) / maxLength;
}

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
  // Pattern 1: "Card Name #CardNumber" (e.g. "Colossus #64", "Split #I-13")
  const match1 = fullName.match(/^(.+?)\s+#([A-Z0-9-]+)$/);
  if (match1) {
    const [, cardName, cardNumber] = match1;
    return {
      setName: '',
      cardNumber: cardNumber.trim(),
      cardName: cardName.trim()
    };
  }
  
  // Pattern 2: "Set Name #Number Card Name" (e.g. "1992 Marvel Masterpieces #15 Spider-Man")
  const match2 = fullName.match(/^(.+?)\s+#([A-Z0-9-]+)\s+(.+)$/);
  if (match2) {
    const [, setName, cardNumber, cardName] = match2;
    return {
      setName: setName.trim(),
      cardNumber: cardNumber.trim(),
      cardName: cardName.trim()
    };
  }
  
  // Pattern 3: "Card Name [What If] #Number" (e.g. "Spider-Man [What If] #12")
  const match3 = fullName.match(/^(.+?)\s+\[(.+?)\]\s+#([A-Z0-9-]+)$/);
  if (match3) {
    const [, cardName, variant, cardNumber] = match3;
    return {
      setName: '',
      cardNumber: cardNumber.trim(),
      cardName: `${cardName.trim()} [${variant.trim()}]`
    };
  }
  
  // Default: use full name as card name
  return {
    setName: '',
    cardNumber: '',
    cardName: fullName.trim()
  };
}

async function testSingleSet() {
  console.log('=== TESTING SINGLE SET WITH IMPROVED FILTERING ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get the What If set
  const sets = await db.select().from(cardSets).where(eq(cardSets.name, 'marvel 2020 masterpieces What If...'));
  const set = sets[0];
  
  console.log(`\nProcessing set: "${set.name}" (ID: ${set.id})`);
  
  // Get current card count
  const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
  console.log(`Current cards in database: ${currentCards.length}`);
  
  // Search PriceCharting
  const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=marvel%202020%20masterpieces&t=${apiKey}`);
  const data: PriceChartingResponse = await response.json();
  const products = data.products || [];
  
  console.log(`Found ${products.length} products from PriceCharting`);
  
  // Apply improved filtering
  const matchingProducts = products.filter(product => {
    const consoleName = product['console-name']?.toLowerCase() || '';
    const setNameLower = set.name.toLowerCase();
    const productNameLower = product['product-name']?.toLowerCase() || '';
    
    // For What If subset, use specific subset matching
    if (setNameLower.includes('what if')) {
      // Product must contain "what if" in either console name or product name
      const hasWhatIf = consoleName.includes('what if') || productNameLower.includes('what if');
      
      // Must also match the year and main set name
      const hasYear = consoleName.includes('2020') || productNameLower.includes('2020');
      const hasMasterpieces = consoleName.includes('masterpieces') || productNameLower.includes('masterpieces');
      
      return hasWhatIf && hasYear && hasMasterpieces;
    }
    
    // For other subsets, use general subset matching logic
    if (setNameLower.includes('autograph') && !consoleName.includes('autograph') && !productNameLower.includes('autograph')) {
      return false; // Reject base set when looking for Autograph subset
    }
    
    if (setNameLower.includes('refractor') && !consoleName.includes('refractor') && !productNameLower.includes('refractor')) {
      return false; // Reject base set when looking for Refractor subset
    }
    
    if (setNameLower.includes('parallel') && !consoleName.includes('parallel') && !productNameLower.includes('parallel')) {
      return false; // Reject base set when looking for Parallel subset
    }
    
    if (setNameLower.includes('short print') && !consoleName.includes('short print') && !productNameLower.includes('short print')) {
      return false; // Reject base set when looking for Short Print subset
    }
    
    // For base sets, use similarity matching (lowered to 90% from 95%)
    const similarity = calculateSimilarity(consoleName, setNameLower);
    return similarity >= 0.90;
  });
  
  console.log(`Filtered to ${matchingProducts.length} matching products`);
  
  if (matchingProducts.length === 0) {
    console.log(`🚨 NO MATCHING PRODUCTS FOUND for "${set.name}" - needs manual investigation`);
    return;
  }
  
  // Process each product
  let newCards = 0;
  let existingCards = 0;
  
  for (const product of matchingProducts) {
    const parsed = parseCardName(product['product-name']);
    
    if (!parsed.cardNumber) {
      console.log(`  Skipping product without card number: ${product['product-name']}`);
      continue;
    }
    
    // Check if card already exists
    const existingCard = await db.select().from(cards)
      .where(eq(cards.setId, set.id))
      .where(eq(cards.cardNumber, parsed.cardNumber))
      .limit(1);
    
    if (existingCard.length > 0) {
      existingCards++;
      continue;
    }
    
    // This would be a new card
    newCards++;
    console.log(`  🆕 NEW CARD: "${parsed.cardName}" #${parsed.cardNumber}`);
    
    // For testing, we'll just log what would be inserted
    // In actual import, this would insert the card
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Total matching products: ${matchingProducts.length}`);
  console.log(`New cards found: ${newCards}`);
  console.log(`Existing cards: ${existingCards}`);
  
  if (newCards > 0) {
    console.log(`\n✅ SUCCESS: Found ${newCards} new cards that would be inserted!`);
  } else {
    console.log(`\n✅ Database appears complete for this set (all cards already exist)`);
  }
}

testSingleSet().catch(console.error);
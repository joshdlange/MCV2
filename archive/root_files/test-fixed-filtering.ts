import { db } from './server/db';
import { cardSets, cards } from './shared/schema';
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

async function testFixedFiltering() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get the What If set
  const sets = await db.select().from(cardSets).where(eq(cardSets.name, 'marvel 2020 masterpieces What If...'));
  const set = sets[0];
  
  console.log(`\n=== TESTING FIXED FILTERING ===`);
  console.log(`Set: "${set.name}" (ID: ${set.id})`);
  console.log(`Current cards in database: ${await db.select().from(cards).where(eq(cards.setId, set.id)).then(r => r.length)}`);

  // Test broad search
  const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=marvel%202020%20masterpieces&t=${apiKey}`);
  const data: PriceChartingResponse = await response.json();
  const products = data.products || [];
  
  console.log(`\nBroad search found: ${products.length} products`);
  
  // Apply improved filtering logic
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
      
      if (hasWhatIf && hasYear && hasMasterpieces) {
        console.log(`  ✅ ACCEPTED: "${product['console-name']}" - Contains What If + 2020 + Masterpieces`);
        return true;
      } else {
        console.log(`  ❌ REJECTED: "${product['console-name']}" - Missing What If (${hasWhatIf}) or 2020 (${hasYear}) or Masterpieces (${hasMasterpieces})`);
        return false;
      }
    }
    
    // For other subsets, use general subset matching logic
    if (setNameLower.includes('autograph') && !consoleName.includes('autograph')) {
      console.log(`  ❌ REJECTED: "${product['console-name']}" - Set contains "autograph" but console name doesn't`);
      return false;
    }
    
    if (setNameLower.includes('refractor') && !consoleName.includes('refractor')) {
      console.log(`  ❌ REJECTED: "${product['console-name']}" - Set contains "refractor" but console name doesn't`);
      return false;
    }
    
    // For base sets, use similarity matching
    const similarity = calculateSimilarity(consoleName, setNameLower);
    if (similarity >= 0.90) {
      console.log(`  ✅ ACCEPTED: "${product['console-name']}" - ${(similarity * 100).toFixed(1)}% similarity`);
      return true;
    } else {
      console.log(`  ❌ REJECTED: "${product['console-name']}" - ${(similarity * 100).toFixed(1)}% similarity < 90%`);
      return false;
    }
  });
  
  console.log(`\n=== FILTERING RESULTS ===`);
  console.log(`Products after filtering: ${matchingProducts.length}`);
  
  if (matchingProducts.length === 0) {
    console.log(`🚨 NO MATCHING PRODUCTS FOUND for "${set.name}"`);
    console.log(`This needs manual investigation.`);
    return;
  }
  
  console.log(`\nMatching products found:`);
  matchingProducts.slice(0, 10).forEach((product, index) => {
    console.log(`  ${index + 1}. "${product['product-name']}" (Console: ${product['console-name']})`);
  });
  
  // Check for potential new cards
  let newCards = 0;
  let existingCards = 0;
  
  console.log(`\n=== CHECKING FOR NEW CARDS ===`);
  for (const product of matchingProducts.slice(0, 10)) {
    const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
    if (match) {
      const [, cardName, cardNumber] = match;
      
      // Check if card exists
      const existing = await db.select().from(cards)
        .where(eq(cards.setId, set.id))
        .where(eq(cards.cardNumber, cardNumber))
        .limit(1);
      
      if (existing.length > 0) {
        existingCards++;
        console.log(`  EXISTS: "${cardName}" #${cardNumber}`);
      } else {
        newCards++;
        console.log(`  🆕 NEW: "${cardName}" #${cardNumber} - WOULD BE INSERTED`);
      }
    }
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Matching products: ${matchingProducts.length}`);
  console.log(`New cards found: ${newCards}`);
  console.log(`Existing cards: ${existingCards}`);
  
  if (newCards > 0) {
    console.log(`\n✅ FILTERING IS WORKING - Found ${newCards} new cards that would be inserted!`);
  } else {
    console.log(`\n⚠️ All cards already exist - this may be correct if database is complete`);
  }
}

testFixedFiltering().catch(console.error);
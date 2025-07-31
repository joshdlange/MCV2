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

async function test5Sets() {
  console.log('=== TESTING 5 DIVERSE SETS (NO DATABASE INSERTION) ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get 5 diverse sets to test
  const testSets = await db.select().from(cardSets).limit(20);
  
  // Select 5 diverse sets
  const selectedSets = [
    testSets.find(s => s.name.toLowerCase().includes('what if')),
    testSets.find(s => s.name.toLowerCase().includes('autograph')),
    testSets.find(s => s.name.toLowerCase().includes('refractor')),
    testSets.find(s => s.name.toLowerCase().includes('masterpieces') && !s.name.toLowerCase().includes('what if')),
    testSets.find(s => !s.name.toLowerCase().includes('what if') && !s.name.toLowerCase().includes('autograph') && !s.name.toLowerCase().includes('refractor'))
  ].filter(Boolean).slice(0, 5);

  // If we don't have diverse sets, just take first 5
  if (selectedSets.length < 5) {
    selectedSets.push(...testSets.slice(0, 5 - selectedSets.length));
  }

  console.log(`\nSelected 5 test sets:`);
  selectedSets.forEach((set, index) => {
    console.log(`${index + 1}. "${set.name}" (ID: ${set.id})`);
  });

  for (let i = 0; i < selectedSets.length; i++) {
    const set = selectedSets[i];
    console.log(`\n==================== SET ${i + 1}/5 ====================`);
    console.log(`Set: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count
    const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
    console.log(`Current cards in database: ${currentCards.length}`);
    
    // Try multiple search strategies
    const searchQueries = [
      encodeURIComponent(set.name),
      encodeURIComponent(set.name.replace(/\.\.\./g, '')),
      encodeURIComponent(set.name.split(' ').slice(0, 3).join(' ')),
      encodeURIComponent(set.name.split(' ').slice(1).join(' '))
    ];
    
    let allMatchingProducts: PriceChartingProduct[] = [];
    
    for (const query of searchQueries) {
      try {
        const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`);
        const data: PriceChartingResponse = await response.json();
        const products = data.products || [];
        
        // Apply improved filtering
        const matchingProducts = products.filter(product => {
          const consoleName = product['console-name']?.toLowerCase() || '';
          const setNameLower = set.name.toLowerCase();
          const productNameLower = product['product-name']?.toLowerCase() || '';
          
          // For What If subset, use specific subset matching
          if (setNameLower.includes('what if')) {
            const hasWhatIf = consoleName.includes('what if') || productNameLower.includes('what if');
            const hasYear = consoleName.includes('2020') || productNameLower.includes('2020');
            const hasMasterpieces = consoleName.includes('masterpieces') || productNameLower.includes('masterpieces');
            return hasWhatIf && hasYear && hasMasterpieces;
          }
          
          // For other subsets, use general subset matching logic
          if (setNameLower.includes('autograph') && !consoleName.includes('autograph') && !productNameLower.includes('autograph')) {
            return false;
          }
          
          if (setNameLower.includes('refractor') && !consoleName.includes('refractor') && !productNameLower.includes('refractor')) {
            return false;
          }
          
          if (setNameLower.includes('parallel') && !consoleName.includes('parallel') && !productNameLower.includes('parallel')) {
            return false;
          }
          
          if (setNameLower.includes('short print') && !consoleName.includes('short print') && !productNameLower.includes('short print')) {
            return false;
          }
          
          // For base sets, use similarity matching
          const similarity = calculateSimilarity(consoleName, setNameLower);
          return similarity >= 0.90;
        });
        
        console.log(`  Query "${decodeURIComponent(query)}" -> ${products.length} total, ${matchingProducts.length} matching`);
        
        // Add unique products
        for (const product of matchingProducts) {
          if (!allMatchingProducts.find(p => p.id === product.id)) {
            allMatchingProducts.push(product);
          }
        }
        
        // Add delay between API calls
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  Query "${decodeURIComponent(query)}" -> ERROR: ${error.message}`);
      }
    }
    
    console.log(`Total unique matching products: ${allMatchingProducts.length}`);
    
    if (allMatchingProducts.length === 0) {
      console.log(`🚨 NO MATCHING PRODUCTS FOUND for "${set.name}"`);
      continue;
    }
    
    // Process products and show what would be inserted
    let newCards = 0;
    let existingCards = 0;
    const cardsToInsert: Array<{ cardNumber: string; cardName: string; consoleName: string }> = [];
    
    for (const product of allMatchingProducts) {
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
      cardsToInsert.push({
        cardNumber: parsed.cardNumber,
        cardName: parsed.cardName,
        consoleName: product['console-name']
      });
    }
    
    console.log(`\n--- RESULTS FOR "${set.name}" ---`);
    console.log(`Existing cards: ${existingCards}`);
    console.log(`New cards found: ${newCards}`);
    
    if (cardsToInsert.length > 0) {
      console.log(`\n🆕 CARDS THAT WOULD BE INSERTED:`);
      cardsToInsert.forEach((card, index) => {
        console.log(`  ${index + 1}. "${card.cardName}" #${card.cardNumber} (from ${card.consoleName})`);
      });
    } else {
      console.log(`✅ No new cards needed - set appears complete`);
    }
  }
  
  console.log(`\n==================== SUMMARY ====================`);
  console.log(`Tested 5 diverse sets with improved filtering logic`);
  console.log(`NO DATABASE CHANGES WERE MADE - this was a test run only`);
  console.log(`Review the results above to confirm filtering is working correctly`);
}

test5Sets().catch(console.error);
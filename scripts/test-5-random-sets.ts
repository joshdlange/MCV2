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

async function test5RandomSets() {
  console.log('=== TESTING 5 RANDOM SETS (NO DATABASE INSERTION) ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Get a random sample of sets, skipping the ones we already tested
  const excludeIds = [1396, 1067, 2, 2139, 1063]; // IDs of previously tested sets
  
  const allSets = await db.select().from(cardSets);
  const availableSets = allSets.filter(set => !excludeIds.includes(set.id));
  
  // Select 5 random sets
  const randomSets = [];
  for (let i = 0; i < 5 && availableSets.length > 0; i++) {
    const randomIndex = Math.floor(Math.random() * availableSets.length);
    randomSets.push(availableSets[randomIndex]);
    availableSets.splice(randomIndex, 1);
  }

  console.log(`\nSelected 5 random sets:`);
  randomSets.forEach((set, index) => {
    console.log(`${index + 1}. "${set.name}" (ID: ${set.id})`);
  });

  for (let i = 0; i < randomSets.length; i++) {
    const set = randomSets[i];
    console.log(`\n==================== SET ${i + 1}/5 ====================`);
    console.log(`Set: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count
    const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
    console.log(`Current cards in database: ${currentCards.length}`);
    
    // Use first 3-4 words for search
    const searchTerm = set.name.split(' ').slice(0, 4).join(' ');
    const query = encodeURIComponent(searchTerm);
    
    try {
      console.log(`Searching PriceCharting for: "${searchTerm}"`);
      const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`);
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
          const hasWhatIf = consoleName.includes('what if') || productNameLower.includes('what if');
          const hasYear = consoleName.includes('2020') || productNameLower.includes('2020');
          const hasMasterpieces = consoleName.includes('masterpieces') || productNameLower.includes('masterpieces');
          return hasWhatIf && hasYear && hasMasterpieces;
        }
        
        // For autograph subset
        if (setNameLower.includes('autograph')) {
          const hasAutograph = consoleName.includes('autograph') || productNameLower.includes('autograph');
          return hasAutograph;
        }
        
        // For refractor subset
        if (setNameLower.includes('refractor')) {
          const hasRefractor = consoleName.includes('refractor') || productNameLower.includes('refractor');
          return hasRefractor;
        }
        
        // For parallel subset
        if (setNameLower.includes('parallel')) {
          const hasParallel = consoleName.includes('parallel') || productNameLower.includes('parallel');
          return hasParallel;
        }
        
        // For base sets, use similarity matching (lowered to 80% for broader matching)
        const similarity = calculateSimilarity(consoleName, setNameLower);
        return similarity >= 0.80;
      });
      
      console.log(`Filtered to ${matchingProducts.length} matching products`);
      
      if (matchingProducts.length === 0) {
        console.log(`🚨 NO MATCHING PRODUCTS FOUND for "${set.name}"`);
        continue;
      }
      
      // Check all products for potential inserts
      let newCards = 0;
      let existingCards = 0;
      const cardsToInsert: Array<{ cardNumber: string; cardName: string; consoleName: string }> = [];
      
      for (const product of matchingProducts) {
        const parsed = parseCardName(product['product-name']);
        
        if (!parsed.cardNumber) {
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
      console.log(`Total matching products: ${matchingProducts.length}`);
      console.log(`Existing cards: ${existingCards}`);
      console.log(`New cards found: ${newCards}`);
      
      if (cardsToInsert.length > 0) {
        console.log(`\n🆕 CARDS THAT WOULD BE INSERTED:`);
        cardsToInsert.forEach((card, index) => {
          console.log(`  ${index + 1}. SET: "${set.name}" | CARD: "${card.cardName}" | NUMBER: #${card.cardNumber} | CONSOLE: ${card.consoleName}`);
        });
      } else {
        console.log(`✅ No new cards needed - set appears complete`);
      }
      
      // Small delay between sets
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`ERROR processing set: ${error.message}`);
    }
  }
  
  console.log(`\n==================== RANDOM TEST COMPLETE ====================`);
  console.log(`Tested 5 random sets from database`);
  console.log(`NO DATABASE CHANGES WERE MADE - this was a test run only`);
  console.log(`\nThis test shows if the database has incomplete sets or if most sets are already complete.`);
}

test5RandomSets().catch(console.error);
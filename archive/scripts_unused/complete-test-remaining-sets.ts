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

async function testRemainingSets() {
  console.log('=== COMPLETING TEST: SETS 2-5 (NO DATABASE INSERTION) ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // The 5 sets we're testing (starting from set 2)
  const testSetNames = [
    'marvel 2020 masterpieces What If...',      // Set 1 - already tested
    '2023 upper deck marvel platinum red rainbow autograph',  // Set 2
    '1993 SkyBox Marvel Masterpieces',          // Set 3
    'marvel 2025 topps finest x men \'97 previously on x men Gold Refractor',  // Set 4
    '1995 fleer dc vs marvel holo fx'           // Set 5
  ];
  
  const selectedSets = [];
  for (const setName of testSetNames) {
    const sets = await db.select().from(cardSets).where(eq(cardSets.name, setName)).limit(1);
    if (sets.length > 0) {
      selectedSets.push(sets[0]);
    }
  }
  
  console.log(`\nTesting sets 2-5:`);
  selectedSets.slice(1).forEach((set, index) => {
    console.log(`${index + 2}. "${set.name}" (ID: ${set.id})`);
  });

  // Start from set 2 (index 1)
  for (let i = 1; i < Math.min(5, selectedSets.length); i++) {
    const set = selectedSets[i];
    console.log(`\n==================== SET ${i + 1}/5 ====================`);
    console.log(`Set: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count
    const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
    console.log(`Current cards in database: ${currentCards.length}`);
    
    // Use optimized search query
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
          if (!hasAutograph) return false;
          
          // Additional matching for year and brand
          const hasYear = setNameLower.includes('2023') ? (consoleName.includes('2023') || productNameLower.includes('2023')) : true;
          const hasUpper = setNameLower.includes('upper') ? (consoleName.includes('upper') || productNameLower.includes('upper')) : true;
          return hasYear && hasUpper;
        }
        
        // For refractor subset
        if (setNameLower.includes('refractor')) {
          const hasRefractor = consoleName.includes('refractor') || productNameLower.includes('refractor');
          if (!hasRefractor) return false;
          
          // Additional matching for specific terms
          const hasFinest = setNameLower.includes('finest') ? (consoleName.includes('finest') || productNameLower.includes('finest')) : true;
          return hasFinest;
        }
        
        // For base sets, use similarity matching
        const similarity = calculateSimilarity(consoleName, setNameLower);
        return similarity >= 0.85;
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
  
  console.log(`\n==================== ALL 5 SETS TESTED ====================`);
  console.log(`SUMMARY:`);
  console.log(`- Set 1 (What If): 0 new cards found (complete)`);
  console.log(`- Sets 2-5: Results shown above`);
  console.log(`\nNO DATABASE CHANGES WERE MADE - this was a test run only`);
  console.log(`\nPlease review the complete results above and confirm if you want to proceed with the full import.`);
}

testRemainingSets().catch(console.error);
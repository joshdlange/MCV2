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

async function quickTest5Sets() {
  console.log('=== QUICK TEST: 5 DIVERSE SETS (NO DATABASE INSERTION) ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Manually select 5 diverse sets to test
  const testSetNames = [
    'marvel 2020 masterpieces What If...',
    '2023 upper deck marvel platinum red rainbow autograph',
    '1993 SkyBox Marvel Masterpieces',
    'marvel 2025 topps finest x men \'97 previously on x men Gold Refractor',
    '1992 Marvel Masterpieces'
  ];
  
  const selectedSets = [];
  for (const setName of testSetNames) {
    const sets = await db.select().from(cardSets).where(eq(cardSets.name, setName)).limit(1);
    if (sets.length > 0) {
      selectedSets.push(sets[0]);
    }
  }
  
  // If we don't have enough, get first 5
  if (selectedSets.length < 5) {
    const additionalSets = await db.select().from(cardSets).limit(5);
    selectedSets.push(...additionalSets.filter(s => !selectedSets.find(existing => existing.id === s.id)).slice(0, 5 - selectedSets.length));
  }

  console.log(`\nSelected 5 test sets:`);
  selectedSets.forEach((set, index) => {
    console.log(`${index + 1}. "${set.name}" (ID: ${set.id})`);
  });

  for (let i = 0; i < Math.min(5, selectedSets.length); i++) {
    const set = selectedSets[i];
    console.log(`\n==================== SET ${i + 1}/5 ====================`);
    console.log(`Set: "${set.name}" (ID: ${set.id})`);
    
    // Get current card count
    const currentCards = await db.select().from(cards).where(eq(cards.setId, set.id));
    console.log(`Current cards in database: ${currentCards.length}`);
    
    // Use single best query for speed
    const query = encodeURIComponent(set.name.split(' ').slice(0, 3).join(' '));
    
    try {
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
        
        // For other subsets, use general subset matching logic
        if (setNameLower.includes('autograph') && !consoleName.includes('autograph') && !productNameLower.includes('autograph')) {
          return false;
        }
        
        if (setNameLower.includes('refractor') && !consoleName.includes('refractor') && !productNameLower.includes('refractor')) {
          return false;
        }
        
        // For base sets, use similarity matching
        const similarity = calculateSimilarity(consoleName, setNameLower);
        return similarity >= 0.90;
      });
      
      console.log(`Filtered to ${matchingProducts.length} matching products`);
      
      if (matchingProducts.length === 0) {
        console.log(`🚨 NO MATCHING PRODUCTS FOUND for "${set.name}"`);
        continue;
      }
      
      // Process first 10 products to show what would be inserted
      let newCards = 0;
      let existingCards = 0;
      const cardsToInsert: Array<{ cardNumber: string; cardName: string; consoleName: string }> = [];
      
      for (const product of matchingProducts.slice(0, 10)) {
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
      console.log(`Total matching products: ${matchingProducts.length}`);
      console.log(`Existing cards (checked first 10): ${existingCards}`);
      console.log(`New cards found (in first 10): ${newCards}`);
      
      if (cardsToInsert.length > 0) {
        console.log(`\n🆕 CARDS THAT WOULD BE INSERTED (from first 10 products):`);
        cardsToInsert.forEach((card, index) => {
          console.log(`  ${index + 1}. Set: "${set.name}" | Card: "${card.cardName}" | #${card.cardNumber} | Console: ${card.consoleName}`);
        });
      } else {
        console.log(`✅ No new cards needed in first 10 products - set may be complete`);
      }
      
      // Add small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.log(`ERROR processing set: ${error.message}`);
    }
  }
  
  console.log(`\n==================== TEST COMPLETE ====================`);
  console.log(`Tested 5 diverse sets with improved filtering logic`);
  console.log(`NO DATABASE CHANGES WERE MADE - this was a test run only`);
  console.log(`\nPlease review the results above and confirm if the filtering logic is working correctly before proceeding with the full import.`);
}

quickTest5Sets().catch(console.error);
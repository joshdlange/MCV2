import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

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
  
  // Fallback: if no card number pattern found
  return {
    setName: fullName.trim(),
    cardNumber: '',
    cardName: fullName.trim()
  };
}

// Fuzzy match set name against database
async function findMatchingSet(setName: string) {
  const allSets = await db.select().from(cardSets);
  const setNameLower = setName.toLowerCase();
  
  // Try exact match first
  const exactMatch = allSets.find(set => set.name.toLowerCase() === setNameLower);
  if (exactMatch) return exactMatch;
  
  // Try partial match (case-insensitive)
  const partialMatch = allSets.find(set => 
    set.name.toLowerCase().includes(setNameLower) || 
    setNameLower.includes(set.name.toLowerCase())
  );
  if (partialMatch) return partialMatch;
  
  // Try word matching
  const setWords = setNameLower.split(' ').filter(w => w.length > 2);
  const wordMatch = allSets.find(set => {
    const setNameWords = set.name.toLowerCase().split(' ');
    const matchedWords = setWords.filter(word => 
      setNameWords.some(setWord => setWord.includes(word) || word.includes(setWord))
    );
    return matchedWords.length >= Math.min(2, setWords.length);
  });
  
  return wordMatch || null;
}

// Main import function
async function runPriceChartingImport() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  console.log('Starting PriceCharting import...');
  const log: string[] = [];
  
  try {
    // Get all existing card sets from database
    const allSets = await db.select().from(cardSets);
    console.log(`Found ${allSets.length} sets in database`);
    log.push(`Found ${allSets.length} sets in database`);
    
    let totalProcessedCount = 0;
    let totalInsertedCount = 0;
    let totalSkippedCount = 0;
    
    // Process all sets - no skipping
    const setsToSkip = [];
    
    // Process each set individually
    for (let i = 0; i < allSets.length; i++) {
      const set = allSets[i];
      
      if (setsToSkip.includes(set.name)) {
        console.log(`\n[${i + 1}/${allSets.length}] Skipping already processed set: "${set.name}"`);
        continue;
      }
      
      console.log(`\n[${i + 1}/${allSets.length}] Processing set: "${set.name}"`);
      log.push(`Processing set: "${set.name}"`);
      
      // Format set name for PriceCharting API (convert to lowercase with dashes)
      const formatSetName = (name: string) => {
        return name.toLowerCase().replace(/\s+/g, '-');
      };
      
      // Try multiple search strategies to find all cards for this set
      const searchQueries = [
        formatSetName(set.name), // Full name formatted
        formatSetName(set.name.replace(/\.\.\.$/, '')), // Remove trailing "..." and format
        formatSetName(set.name.split(' ').slice(0, 3).join(' ')), // First 3 words formatted
        formatSetName(set.name.split(' ').slice(1).join(' ')), // Skip first word and format
        formatSetName(set.name.replace(/\d{4}\s+/, '')), // Remove year and format
      ];
      
      let allProducts: PriceChartingProduct[] = [];
      const uniqueProducts = new Set<string>();
      
      for (const query of searchQueries) {
        const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`;
        console.log(`  Trying query: "${query}"`);
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
          console.log(`    Query failed: ${response.status}`);
          continue;
        }
        
        const data: PriceChartingResponse = await response.json();
        const products = data.products || [];
        
        // Filter products that match this specific set with high precision
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
        
        // Add unique products
        matchingProducts.forEach(product => {
          const key = `${product['product-name']}-${product['console-name']}`;
          if (!uniqueProducts.has(key)) {
            uniqueProducts.add(key);
            allProducts.push(product);
          }
        });
        
        console.log(`    Found ${products.length} total, ${matchingProducts.length} matching`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between queries
      }
      
      console.log(`Total unique products found: ${allProducts.length}`);
      log.push(`Found ${allProducts.length} products for set "${set.name}" using multiple search strategies`);
      
      // Log sets with zero matches for manual review
      if (allProducts.length === 0) {
        console.log(`  🚨 NO MATCHING PRODUCTS FOUND for "${set.name}" - logging for manual review`);
        writeFileSync('zero-match-sets.log', `${set.name} (ID: ${set.id}) - No matching products found\n`, { flag: 'a' });
        continue;
      }
      
      const products = allProducts;
      
      let setInsertedCount = 0;
      
      // Process each product for this set
      for (const product of products) {
        try {
          totalProcessedCount++;
          
          // Skip non-trading card products
          const consoleName = product['console-name']?.toLowerCase() || '';
          const productName = product['product-name']?.toLowerCase() || '';
          
          // These are already trading cards since we queried platform=trading-card
          // Just filter out obvious non-cards
          const isNotCard = consoleName.includes('video') || 
                           consoleName.includes('game') || 
                           consoleName.includes('toy') ||
                           productName.includes('video') ||
                           productName.includes('game');
          
          if (isNotCard) {
            totalSkippedCount++;
            continue;
          }
          
          // Parse the product name
          const parsed = parseCardName(product['product-name']);
          console.log(`  Processing: ${product['product-name']} -> Card: "${parsed.cardName}", Number: "${parsed.cardNumber}"`);
          
          // Check if card already exists in this specific set
          const existingCard = await db
            .select()
            .from(cards)
            .where(eq(cards.setId, set.id))
            .where(eq(cards.cardNumber, parsed.cardNumber))
            .limit(1);
          
          if (existingCard.length > 0) {
            console.log(`    Card already exists: ${parsed.cardNumber}`);
            totalSkippedCount++;
            continue;
          }
          
          // Insert new card
          await db.insert(cards).values({
            setId: set.id,
            cardNumber: parsed.cardNumber,
            name: parsed.cardName,
            frontImageUrl: product.image || null,
            estimatedValue: product['loose-price'] ? product['loose-price'].toString() : null,
            rarity: 'Common', // Default value to satisfy NOT NULL constraint
            variation: null,
            isInsert: false,
            backImageUrl: null,
            description: null,
            createdAt: new Date()
          });
          
          console.log(`    ✅ Inserted card: "${parsed.cardName}" #${parsed.cardNumber}`);
          log.push(`Inserted: "${parsed.cardName}" #${parsed.cardNumber} into "${set.name}"`);
          setInsertedCount++;
          totalInsertedCount++;
          
        } catch (error) {
          console.error(`❌ Error processing product "${product['product-name']}":`, error);
          log.push(`Error processing "${product['product-name']}": ${error instanceof Error ? error.message : String(error)}`);
          totalSkippedCount++;
          continue;
        }
      }
      
      console.log(`✅ Set "${set.name}" processed: ${setInsertedCount} cards added`);
      log.push(`Set "${set.name}" processed: ${setInsertedCount} cards added`);
      
      // Add delay between sets to respect rate limiting
      if (i < allSets.length - 1) {
        console.log('⏱️  Waiting 1 second before next set...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Final summary
    console.log('\n🎉 Import completed!');
    console.log(`Total sets processed: ${allSets.length}`);
    console.log(`Total products processed: ${totalProcessedCount}`);
    console.log(`Total cards inserted: ${totalInsertedCount}`);
    console.log(`Total products skipped: ${totalSkippedCount}`);
    
    log.push(`\nImport Summary:`);
    log.push(`Total sets processed: ${allSets.length}`);
    log.push(`Total products processed: ${totalProcessedCount}`);
    log.push(`Total cards inserted: ${totalInsertedCount}`);
    log.push(`Total products skipped: ${totalSkippedCount}`);
    
    // Write log file
    writeFileSync('import.log', log.join('\n'));
    console.log('Import log written to import.log');
    
  } catch (error) {
    console.error('Import failed:', error);
    log.push(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    writeFileSync('import.log', log.join('\n'));
    throw error;
  }
}

// Run the import
runPriceChartingImport().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
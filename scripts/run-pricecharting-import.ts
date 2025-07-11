import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

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
    
    // Skip these two sets that we've already processed
    const setsToSkip = [
      "2023 upper deck marvel platinum red rainbow autograph",
      "1993 SkyBox Marvel Masterpieces"
    ];
    
    // Process each set individually
    for (let i = 0; i < allSets.length; i++) {
      const set = allSets[i];
      
      if (setsToSkip.includes(set.name)) {
        console.log(`\n[${i + 1}/${allSets.length}] Skipping already processed set: "${set.name}"`);
        continue;
      }
      
      console.log(`\n[${i + 1}/${allSets.length}] Processing set: "${set.name}"`);
      log.push(`Processing set: "${set.name}"`);
      
      // Try multiple search strategies to find all cards for this set
      const searchQueries = [
        set.name, // Original exact name
        set.name.replace(/\.\.\.$/, ''), // Remove trailing "..."
        set.name.split(' ').slice(0, 3).join(' '), // First 3 words
        set.name.split(' ').slice(1).join(' '), // Skip first word
        set.name.replace(/\d{4}\s+/, ''), // Remove year
      ];
      
      let allProducts: PriceChartingProduct[] = [];
      const uniqueProducts = new Set<string>();
      
      for (const query of searchQueries) {
        const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(query)}&t=${apiKey}`;
        console.log(`  Trying query: "${query}"`);
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
          console.log(`    Query failed: ${response.status}`);
          continue;
        }
        
        const data: PriceChartingResponse = await response.json();
        const products = data.products || [];
        
        // Filter products that match this specific set
        const matchingProducts = products.filter(product => {
          const consoleName = product['console-name']?.toLowerCase() || '';
          const setNameLower = set.name.toLowerCase();
          
          // Check if console name contains key parts of our set name
          const setWords = setNameLower.split(' ').filter(word => word.length > 2);
          const matchCount = setWords.filter(word => consoleName.includes(word)).length;
          
          return matchCount >= Math.min(3, setWords.length); // Match at least 3 words or all words if less than 3
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
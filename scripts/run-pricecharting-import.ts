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
  // Example: "1992 Marvel Masterpieces #15 Spider-Man"
  const match = fullName.match(/^(.+?)\s+#(\d+(?:\w+)?)\s+(.+)$/);
  
  if (match) {
    const [, setName, cardNumber, cardName] = match;
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
    // Call the correct PriceCharting API endpoint
    const apiUrl = `https://www.pricecharting.com/api/products?t=${apiKey}&q=marvel`;
    console.log('Calling PriceCharting API...');
    log.push(`API Call: ${apiUrl.replace(apiKey, 'HIDDEN_KEY')}`);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data: PriceChartingResponse = await response.json();
    console.log(`Found ${data.products?.length || 0} products from PriceCharting`);
    log.push(`Found ${data.products?.length || 0} products from PriceCharting`);
    
    if (!data.products || !Array.isArray(data.products)) {
      throw new Error('Invalid API response format');
    }
    
    let processedCount = 0;
    let insertedCount = 0;
    let skippedCount = 0;
    
    // Process each product
    for (const product of data.products) {
      try {
        processedCount++;
        
        // Skip non-trading card products
        const consoleName = product['console-name']?.toLowerCase() || '';
        const productName = product['product-name']?.toLowerCase() || '';
        
        // Filter for trading cards only
        const isTradingCard = consoleName.includes('trading') || 
                             consoleName.includes('card') ||
                             productName.includes('trading') ||
                             productName.includes('card') ||
                             consoleName.includes('marvel') ||
                             productName.includes('marvel');
        
        if (!isTradingCard) {
          skippedCount++;
          continue;
        }
        
        // Parse the product name
        const parsed = parseCardName(product['product-name']);
        console.log(`Processing: ${product['product-name']} -> Set: "${parsed.setName}", Card: "${parsed.cardName}", Number: "${parsed.cardNumber}"`);
        
        // Find matching set in database
        const matchingSet = await findMatchingSet(parsed.setName);
        
        if (!matchingSet) {
          console.log(`⚠️  No matching set found for: "${parsed.setName}"`);
          log.push(`No matching set found for: "${parsed.setName}"`);
          skippedCount++;
          continue;
        }
        
        console.log(`✅ Found matching set: "${matchingSet.name}" (ID: ${matchingSet.id})`);
        
        // Check if card already exists
        const existingCard = await db
          .select()
          .from(cards)
          .where(eq(cards.setId, matchingSet.id))
          .where(eq(cards.cardNumber, parsed.cardNumber))
          .limit(1);
        
        if (existingCard.length > 0) {
          console.log(`   Card already exists: ${parsed.cardNumber}`);
          skippedCount++;
          continue;
        }
        
        // Insert new card
        await db.insert(cards).values({
          setId: matchingSet.id,
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
        
        console.log(`   ✅ Inserted card: "${parsed.cardName}" #${parsed.cardNumber}`);
        log.push(`Inserted: "${parsed.cardName}" #${parsed.cardNumber} into "${matchingSet.name}"`);
        insertedCount++;
        
      } catch (error) {
        console.error(`❌ Error processing product "${product.name}":`, error);
        log.push(`Error processing "${product.name}": ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    
    // Final summary
    console.log('\n🎉 Import completed!');
    console.log(`Processed: ${processedCount} products`);
    console.log(`Inserted: ${insertedCount} new cards`);
    console.log(`Skipped: ${skippedCount} products`);
    
    log.push(`\nImport Summary:`);
    log.push(`Processed: ${processedCount} products`);
    log.push(`Inserted: ${insertedCount} new cards`);
    log.push(`Skipped: ${skippedCount} products`);
    
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
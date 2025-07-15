import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count, and, sql } from 'drizzle-orm';
import { createWriteStream } from 'fs';

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

// Enhanced logging system
class ImportLogger {
  private logFile: any;
  private statusFile: any;
  
  constructor() {
    this.logFile = createWriteStream('bulletproof-import.log', { flags: 'a' });
    this.statusFile = createWriteStream('import-status.json', { flags: 'w' });
  }
  
  log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    this.logFile.write(logMessage + '\n');
  }
  
  updateStatus(status: any) {
    this.statusFile.write(JSON.stringify(status, null, 2));
  }
  
  close() {
    this.logFile.end();
    this.statusFile.end();
  }
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bulletproofImport() {
  const logger = new ImportLogger();
  logger.log('=== BULLETPROOF PRICECHARTING IMPORT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  logger.log('Starting bulletproof import...');
  logger.log(`API Key present: ${apiKey ? 'YES' : 'NO'}`);

  // Get baseline card count
  const [baselineResult] = await db.select({ count: count() }).from(cards);
  const baselineCount = baselineResult.count;
  logger.log(`Baseline card count: ${baselineCount}`);

  // Get all sets
  const allSets = await db.select().from(cardSets).orderBy(cardSets.id);
  logger.log(`Total sets to process: ${allSets.length}`);

  // Get already processed sets
  let processedSets: any[] = [];
  try {
    processedSets = await db.execute(sql`
      SELECT set_id FROM processed_sets WHERE status = 'completed'
    `);
  } catch (error) {
    logger.log('Processed sets table not found, will process all sets');
    processedSets = [];
  }
  
  const processedSetIds = new Set(processedSets.map((row: any) => row.set_id));
  const unprocessedSets = allSets.filter(set => !processedSetIds.has(set.id));
  
  logger.log(`Already processed: ${processedSetIds.size} sets`);
  logger.log(`Remaining to process: ${unprocessedSets.length} sets`);

  let totalSetsProcessed = 0;
  let totalNewCards = 0;
  let setsWithNewCards = 0;
  let setsWithErrors = 0;

  // Process each unprocessed set
  for (let i = 0; i < unprocessedSets.length; i++) {
    const set = unprocessedSets[i];
    const setProgress = `[${i+1}/${unprocessedSets.length}]`;
    
    logger.log(`${setProgress} Processing: "${set.name}" (ID: ${set.id})`);
    
    try {
      // Get current card count for this set
      const [currentCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
      logger.log(`  Current cards in set: ${currentCardCount.count}`);

      // Format query with dashes (PriceCharting URL format)
      const formattedQuery = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      logger.log(`  Query: "${formattedQuery}"`);

      // Make API call with retry logic
      let response;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${formattedQuery}&t=${apiKey}`;
          logger.log(`  URL: ${url}`);
          
          response = await fetch(url, {
            headers: {
              'User-Agent': 'Marvel Card Vault Import Script',
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            break;
          } else {
            logger.log(`  API call failed (${response.status}), retrying...`);
            retryCount++;
            await sleep(5000);
          }
        } catch (error) {
          logger.log(`  API call error: ${error}, retrying...`);
          retryCount++;
          await sleep(5000);
        }
      }

      if (!response || !response.ok) {
        logger.log(`  Failed to fetch data after ${maxRetries} retries`);
        setsWithErrors++;
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      logger.log(`  Found ${data.products.length} products from PriceCharting`);

      if (data.products.length === 0) {
        logger.log(`  No products found for query: ${formattedQuery}`);
        // Mark as processed even if no products found
        await db.execute(sql`
          INSERT INTO processed_sets (set_id, set_name, cards_added, status)
          VALUES (${set.id}, ${set.name}, 0, 'completed')
          ON CONFLICT (set_id) DO UPDATE SET
            processed_at = CURRENT_TIMESTAMP,
            cards_added = 0,
            status = 'completed'
        `).catch(console.error);
        continue;
      }

      // Get existing cards in the set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardMap = new Map();
      
      for (const card of existingCards) {
        // Create multiple lookup keys for better matching
        const keys = [
          `${card.name}::${card.cardNumber}`,
          card.name.toLowerCase(),
          card.cardNumber,
          `${card.name.toLowerCase()}::${card.cardNumber}`,
        ];
        keys.forEach(key => existingCardMap.set(key, card));
      }

      // Show sample products
      const sampleProducts = data.products.slice(0, 3);
      logger.log(`  Sample products:`);
      sampleProducts.forEach((product, idx) => {
        logger.log(`    ${idx + 1}. "${product['product-name']}" (${product['console-name']})`);
      });

      let newCardsAdded = 0;

      // Process each product
      for (const product of data.products) {
        const productName = product['product-name'];
        const consoleName = product['console-name'];
        
        // Skip if not Marvel trading card
        if (!consoleName.toLowerCase().includes('marvel')) {
          continue;
        }

        // Parse card number and name
        let cardNumber = '';
        let cardName = productName;
        
        // Try to extract card number from the product name
        const numberMatch = productName.match(/#([A-Z0-9-]+)/i);
        if (numberMatch) {
          cardNumber = numberMatch[1];
          cardName = productName.replace(/#[A-Z0-9-]+/i, '').trim();
        }

        // Clean up card name
        cardName = cardName.replace(/\[.*?\]/g, '').trim();

        // Check if card already exists using multiple strategies
        const lookupKeys = [
          `${cardName}::${cardNumber}`,
          cardName.toLowerCase(),
          cardNumber,
          `${cardName.toLowerCase()}::${cardNumber}`,
        ];
        
        let cardExists = false;
        for (const key of lookupKeys) {
          if (existingCardMap.has(key)) {
            cardExists = true;
            break;
          }
        }

        if (cardExists) {
          continue;
        }

        // Insert new card
        try {
          await db.insert(cards).values({
            setId: set.id,
            cardNumber: cardNumber || `PC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: cardName,
            variation: null,
            rarity: 'Common',
            isInsert: false,
            description: `Imported from PriceCharting: ${consoleName}`,
            frontImageUrl: product.image || null,
            backImageUrl: null,
            estimatedValue: product['loose-price'] || null,
          });

          logger.log(`    ✅ Added: "${cardName}" #${cardNumber}`);
          newCardsAdded++;
          
          // Add to existing map to prevent duplicates within same set
          existingCardMap.set(`${cardName}::${cardNumber}`, { name: cardName, cardNumber });
          
        } catch (error) {
          logger.log(`    ❌ Failed to add "${cardName}": ${error}`);
        }
      }

      logger.log(`  📊 Result: ${newCardsAdded} new cards added to set`);
      
      if (newCardsAdded > 0) {
        logger.log(`  🎯 SET WITH NEW CARDS: "${set.name}" (+${newCardsAdded})`);
        setsWithNewCards++;
      }

      totalNewCards += newCardsAdded;
      totalSetsProcessed++;

      // Mark set as processed
      await db.execute(sql`
        INSERT INTO processed_sets (set_id, set_name, cards_added, status)
        VALUES (${set.id}, ${set.name}, ${newCardsAdded}, 'completed')
        ON CONFLICT (set_id) DO UPDATE SET
          processed_at = CURRENT_TIMESTAMP,
          cards_added = ${newCardsAdded},
          status = 'completed'
      `).catch(console.error);

      // Update status
      const status = {
        totalSetsToProcess: unprocessedSets.length,
        setsProcessed: totalSetsProcessed,
        setsWithNewCards,
        setsWithErrors,
        totalNewCards,
        currentSet: set.name,
        progress: `${totalSetsProcessed}/${unprocessedSets.length}`,
        lastUpdate: new Date().toISOString()
      };
      
      logger.updateStatus(status);

      // Rate limiting - wait between requests
      await sleep(2000);

    } catch (error) {
      logger.log(`  ❌ Error processing set "${set.name}": ${error}`);
      setsWithErrors++;
      
      // Mark as error for retry later
      await db.execute(sql`
        INSERT INTO processed_sets (set_id, set_name, cards_added, status)
        VALUES (${set.id}, ${set.name}, 0, 'error')
        ON CONFLICT (set_id) DO UPDATE SET
          processed_at = CURRENT_TIMESTAMP,
          cards_added = 0,
          status = 'error'
      `).catch(console.error);
    }
  }

  // Final summary
  const [finalCardCount] = await db.select({ count: count() }).from(cards);
  const finalCount = finalCardCount.count;
  
  logger.log('\n=== IMPORT COMPLETE ===');
  logger.log(`Cards before: ${baselineCount}`);
  logger.log(`Cards after: ${finalCount}`);
  logger.log(`New cards added: ${totalNewCards}`);
  logger.log(`Sets processed: ${totalSetsProcessed}`);
  logger.log(`Sets with new cards: ${setsWithNewCards}`);
  logger.log(`Sets with errors: ${setsWithErrors}`);
  logger.log(`Success rate: ${((totalSetsProcessed / unprocessedSets.length) * 100).toFixed(1)}%`);
  
  logger.close();
}

// Run the import
bulletproofImport().catch(console.error);
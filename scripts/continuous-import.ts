import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, count } from 'drizzle-orm';
import { writeFileSync, readFileSync } from 'fs';

interface ImportProgress {
  currentSetIndex: number;
  totalSets: number;
  totalNewCards: number;
  setsProcessed: number;
  setsWithNewCards: number;
  setsWithErrors: number;
  lastProcessedTime: string;
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

const PROGRESS_FILE = 'import-progress.json';
const LOG_FILE = 'continuous-import.log';

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  try {
    writeFileSync(LOG_FILE, logMessage + '\n', { flag: 'a' });
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}

function saveProgress(progress: ImportProgress) {
  try {
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (error) {
    console.error('Failed to save progress:', error);
  }
}

function loadProgress(): ImportProgress {
  try {
    const data = readFileSync(PROGRESS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {
      currentSetIndex: 0,
      totalSets: 0,
      totalNewCards: 0,
      setsProcessed: 0,
      setsWithNewCards: 0,
      setsWithErrors: 0,
      lastProcessedTime: new Date().toISOString()
    };
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function continuousImport() {
  log('=== CONTINUOUS IMPORT STARTED ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN is required');
  }

  // Get all sets
  const allSets = await db.select().from(cardSets).orderBy(cardSets.id);
  log(`Found ${allSets.length} total sets`);

  // Load or create progress
  let progress = loadProgress();
  if (progress.totalSets === 0) {
    progress.totalSets = allSets.length;
    saveProgress(progress);
  }

  log(`Resuming from set ${progress.currentSetIndex + 1}/${progress.totalSets}`);
  log(`Previous progress: ${progress.setsProcessed} processed, ${progress.totalNewCards} new cards`);

  // Process remaining sets
  while (progress.currentSetIndex < allSets.length) {
    const set = allSets[progress.currentSetIndex];
    const setProgress = `[${progress.currentSetIndex + 1}/${progress.totalSets}]`;
    
    log(`${setProgress} Processing: "${set.name}" (ID: ${set.id})`);
    
    try {
      // Get current cards in set
      const [currentResult] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
      const currentCount = currentResult.count;
      log(`  Current cards: ${currentCount}`);

      // Format query for API
      const query = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      log(`  Query: "${query}"`);

      // API call with retry
      let response;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const url = `https://www.pricecharting.com/api/products?platform=trading-card&q=${query}&t=${apiKey}`;
          
          response = await fetch(url, {
            headers: {
              'User-Agent': 'Marvel Card Vault Import',
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            break;
          } else {
            log(`  API error ${response.status}, attempt ${attempts + 1}/${maxAttempts}`);
            attempts++;
            await sleep(5000 * attempts); // Exponential backoff
          }
        } catch (error) {
          log(`  Network error: ${error}, attempt ${attempts + 1}/${maxAttempts}`);
          attempts++;
          await sleep(5000 * attempts);
        }
      }

      if (!response || !response.ok) {
        log(`  Failed after ${maxAttempts} attempts, marking as error`);
        progress.setsWithErrors++;
        progress.currentSetIndex++;
        progress.setsProcessed++;
        progress.lastProcessedTime = new Date().toISOString();
        saveProgress(progress);
        await sleep(2000);
        continue;
      }

      const data: PriceChartingResponse = await response.json();
      log(`  Found ${data.products.length} products`);

      if (data.products.length === 0) {
        log(`  No products found, continuing`);
        progress.currentSetIndex++;
        progress.setsProcessed++;
        progress.lastProcessedTime = new Date().toISOString();
        saveProgress(progress);
        await sleep(1000);
        continue;
      }

      // Get existing cards
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardKeys = new Set<string>();
      
      for (const card of existingCards) {
        existingCardKeys.add(`${card.name.toLowerCase()}::${card.cardNumber}`);
        existingCardKeys.add(card.name.toLowerCase().trim());
        existingCardKeys.add(card.cardNumber);
      }

      let newCardsForSet = 0;
      const addedCards: string[] = [];

      // Process each product
      for (const product of data.products) {
        const productName = product['product-name'];
        const consoleName = product['console-name'];
        
        // Only Marvel cards
        if (!consoleName.toLowerCase().includes('marvel')) {
          continue;
        }

        // Parse card info
        let cardNumber = '';
        let cardName = productName;
        
        const numberMatch = productName.match(/#([A-Z0-9-]+)/i);
        if (numberMatch) {
          cardNumber = numberMatch[1];
          cardName = productName.replace(/#[A-Z0-9-]+/i, '').trim();
        }

        cardName = cardName.replace(/\[.*?\]/g, '').trim();

        // Check if exists
        const cardKeys = [
          `${cardName.toLowerCase()}::${cardNumber}`,
          cardName.toLowerCase().trim(),
          cardNumber,
        ];

        let exists = false;
        for (const key of cardKeys) {
          if (existingCardKeys.has(key)) {
            exists = true;
            break;
          }
        }

        if (exists) {
          continue;
        }

        // Add new card
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

          addedCards.push(`"${cardName}" #${cardNumber}`);
          newCardsForSet++;
          progress.totalNewCards++;
          
          // Add to existing set
          existingCardKeys.add(`${cardName.toLowerCase()}::${cardNumber}`);
          
        } catch (error) {
          log(`    Failed to add "${cardName}": ${error}`);
        }
      }

      // Log results
      if (newCardsForSet > 0) {
        log(`  ✅ Added ${newCardsForSet} new cards:`);
        addedCards.forEach(card => log(`    - ${card}`));
        progress.setsWithNewCards++;
      } else {
        log(`  No new cards added`);
      }

      progress.currentSetIndex++;
      progress.setsProcessed++;
      progress.lastProcessedTime = new Date().toISOString();
      saveProgress(progress);

      // Progress update every 10 sets
      if (progress.setsProcessed % 10 === 0) {
        log(`--- PROGRESS UPDATE ---`);
        log(`Sets processed: ${progress.setsProcessed}/${progress.totalSets}`);
        log(`Sets with new cards: ${progress.setsWithNewCards}`);
        log(`Total new cards: ${progress.totalNewCards}`);
        log(`Sets with errors: ${progress.setsWithErrors}`);
        log(`Success rate: ${((progress.setsProcessed / progress.totalSets) * 100).toFixed(1)}%`);
        log(`----------------------`);
      }

      // Rate limiting
      await sleep(2000);

    } catch (error) {
      log(`  Error processing set: ${error}`);
      progress.setsWithErrors++;
      progress.currentSetIndex++;
      progress.setsProcessed++;
      progress.lastProcessedTime = new Date().toISOString();
      saveProgress(progress);
      await sleep(1000);
    }
  }

  // Final summary
  const [finalResult] = await db.select({ count: count() }).from(cards);
  const finalCount = finalResult.count;
  
  log('=== IMPORT COMPLETE ===');
  log(`Final card count: ${finalCount}`);
  log(`New cards added: ${progress.totalNewCards}`);
  log(`Sets processed: ${progress.setsProcessed}/${progress.totalSets}`);
  log(`Sets with new cards: ${progress.setsWithNewCards}`);
  log(`Sets with errors: ${progress.setsWithErrors}`);
  log(`Success rate: ${((progress.setsProcessed / progress.totalSets) * 100).toFixed(1)}%`);
  log('======================');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the import
continuousImport().catch(error => {
  log(`Import failed: ${error}`);
  process.exit(1);
});
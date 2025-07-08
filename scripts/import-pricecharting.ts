#!/usr/bin/env tsx
import { db } from '../server/db';
import { cardSets, cards } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface PriceChartingProduct {
  id: string;
  "product-name": string;
  "console-name": string;
  genre: string;
  "loose-price": number;
  "cib-price": number;
  "new-price": number;
  "graded-price": number;
  upc?: string;
  asin?: string;
  epid?: string;
  [key: string]: any;
}

interface PriceChartingCard {
  id: string;
  "product-name": string;
  card_number?: string;
  price: number;
  image_url?: string;
  product_id: string;
  [key: string]: any;
}

interface ImportResult {
  setsProcessed: number;
  setsInserted: number;
  setsSkipped: number;
  cardsProcessed: number;
  cardsInserted: number;
  cardsSkipped: number;
  errors: string[];
  skippedItems: Array<{
    type: 'set' | 'card';
    name: string;
    reason: string;
  }>;
}

interface ImportOptions {
  limit?: number;
  rateLimitMs?: number;
  logFile?: string;
}

/**
 * Upload image to Cloudinary from URL
 */
async function uploadImageToCloudinary(imageUrl: string, cardId: number): Promise<string | null> {
  try {
    console.log(`☁️ Uploading image to Cloudinary for card ${cardId}`);
    
    // Validate Cloudinary configuration
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      console.error('❌ Cloudinary configuration missing');
      return null;
    }
    
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'marvel-cards',
      public_id: `pricecharting_card_${cardId}_${Date.now()}`,
      transformation: [
        { width: 400, height: 560, crop: 'fit', quality: 'auto' },
        { format: 'webp' }
      ]
    });

    console.log(`✅ Successfully uploaded to Cloudinary for card ${cardId}`);
    return result.secure_url;

  } catch (error) {
    console.error(`❌ Cloudinary upload failed for card ${cardId}:`, error);
    return null;
  }
}

/**
 * Generate slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Extract year from set name
 */
function extractYear(setName: string): number {
  const yearMatch = setName.match(/\b(19|20)\d{2}\b/);
  return yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
}

/**
 * Extract card number from product name
 */
function extractCardNumber(productName: string): string {
  // Look for patterns like "#123", "Card 123", "No. 123", etc.
  const patterns = [
    /#(\d+)/,
    /Card\s+(\d+)/i,
    /No\.\s*(\d+)/i,
    /\b(\d+)\b/
  ];
  
  for (const pattern of patterns) {
    const match = productName.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return "1"; // Default card number
}

/**
 * Clean and format card name
 */
function formatCardName(productName: string): string {
  // Remove card number patterns and clean up
  return productName
    .replace(/#\d+/g, '')
    .replace(/Card\s+\d+/gi, '')
    .replace(/No\.\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch Marvel products from PriceCharting API
 */
async function fetchMarvelProducts(): Promise<PriceChartingProduct[]> {
  const token = process.env.PRICECHARTING_API_TOKEN;
  if (!token) {
    throw new Error('PRICECHARTING_API_TOKEN not found in environment variables');
  }

  console.log('📡 Fetching Marvel products from PriceCharting API...');
  
  // Search for Marvel trading cards using the q parameter
  const searchQueries = [
    'marvel trading cards',
    'spider-man marvel',
    'x-men marvel',
    'wolverine marvel',
    'iron man marvel',
    'captain america marvel',
    'thor marvel',
    'hulk marvel',
    'fantastic four marvel',
    'avengers marvel'
  ];
  
  const allProducts: PriceChartingProduct[] = [];
  
  for (const query of searchQueries) {
    try {
      console.log(`🔍 Searching for: ${query}`);
      
      const response = await fetch(`https://www.pricecharting.com/api/products?t=${token}&q=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`❌ PriceCharting API error for "${query}": ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      
      if (data.products && Array.isArray(data.products)) {
        // Filter for trading cards and comic books (which include trading cards)
        const marvelCards = data.products.filter((product: PriceChartingProduct) => {
          const name = (product['product-name'] || '').toLowerCase();
          const console = (product['console-name'] || '').toLowerCase();
          const genre = (product.genre || '').toLowerCase();
          
          // Look for Marvel characters and trading cards or comic books
          const isMarvelRelated = name.includes('marvel') ||
            name.includes('spider') ||
            name.includes('x-men') ||
            name.includes('wolverine') ||
            name.includes('iron man') ||
            name.includes('captain america') ||
            name.includes('thor') ||
            name.includes('hulk') ||
            name.includes('fantastic four') ||
            name.includes('avengers');
            
          // Check if it's a trading card or comic book
          const isCard = console.includes('comic') || 
            console.includes('card') || 
            genre.includes('comic') ||
            name.includes('card') ||
            name.includes('trading');
            
          return isMarvelRelated && isCard;
        });
        
        allProducts.push(...marvelCards);
        console.log(`✅ Found ${marvelCards.length} Marvel products for "${query}"`);
      }
      
      // Rate limiting between searches (5 minutes as per API docs)
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second for testing
      
    } catch (error) {
      console.error(`❌ Error searching for "${query}":`, error);
    }
  }
  
  // Remove duplicates based on product ID
  const uniqueProducts = allProducts.filter((product, index, self) => 
    index === self.findIndex(p => p.id === product.id)
  );

  console.log(`📊 Found ${uniqueProducts.length} unique Marvel trading card products`);
  return uniqueProducts;
}

/**
 * Fetch cards for a specific product from PriceCharting API
 */
async function fetchProductCards(productId: number): Promise<PriceChartingCard[]> {
  const token = process.env.PRICECHARTING_API_TOKEN;
  if (!token) {
    throw new Error('PRICECHARTING_API_TOKEN not found in environment variables');
  }

  console.log(`🔍 Fetching cards for product ID ${productId}...`);
  
  const response = await fetch(`https://www.pricecharting.com/api/product?t=${token}&id=${productId}`, {
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`PriceCharting API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // For individual products, we might get the product data directly
  // We'll need to adapt this based on the actual API response structure
  if (data.product) {
    return [{
      id: data.product.id,
      "product-name": data.product['product-name'],
      card_number: "1", // Default, will be extracted from name
      price: data.product['loose-price'] || data.product['cib-price'] || data.product['new-price'] || 0,
      image_url: data.product.image_url,
      product_id: productId
    }];
  }
  
  return [];
}

/**
 * Check if a card set exists by name
 */
async function findExistingSet(setName: string): Promise<any | null> {
  const existingSets = await db.select().from(cardSets).where(eq(cardSets.name, setName));
  return existingSets.length > 0 ? existingSets[0] : null;
}

/**
 * Check if a card exists in a set
 */
async function findExistingCard(setId: number, cardNumber: string): Promise<any | null> {
  const existingCards = await db.select().from(cards).where(
    and(
      eq(cards.setId, setId),
      eq(cards.cardNumber, cardNumber)
    )
  );
  return existingCards.length > 0 ? existingCards[0] : null;
}

/**
 * Insert a new card set
 */
async function insertCardSet(setName: string, year: number): Promise<number> {
  const slug = generateSlug(setName);
  
  const insertedSets = await db.insert(cardSets).values({
    name: setName,
    slug: slug,
    year: year,
    description: `Imported from PriceCharting on ${new Date().toISOString()}`,
    mainSetId: null, // Will be manually assigned later
    totalCards: 0 // Will be updated as cards are added
  }).returning({ id: cardSets.id });

  return insertedSets[0].id;
}

/**
 * Insert a new card
 */
async function insertCard(
  setId: number,
  cardName: string,
  cardNumber: string,
  price: number,
  imageUrl?: string
): Promise<number> {
  const cloudinaryUrl = imageUrl ? await uploadImageToCloudinary(imageUrl, 0) : null;
  
  const insertedCards = await db.insert(cards).values({
    setId: setId,
    cardNumber: cardNumber,
    name: cardName,
    rarity: 'Unknown', // Required field, will be updated later
    estimatedValue: price.toString(),
    frontImageUrl: cloudinaryUrl,
    variation: null,
    isInsert: false,
    description: null,
    backImageUrl: null
  }).returning({ id: cards.id });

  return insertedCards[0].id;
}

/**
 * Update card set total count
 */
async function updateSetCardCount(setId: number): Promise<void> {
  const cardCount = await db.select().from(cards).where(eq(cards.setId, setId));
  await db.update(cardSets)
    .set({ totalCards: cardCount.length })
    .where(eq(cardSets.id, setId));
}

/**
 * Main import function
 */
export async function importPriceChartingData(options: ImportOptions = {}): Promise<ImportResult> {
  const {
    limit = 50,
    rateLimitMs = 2000,
    logFile = 'pricecharting-import.log'
  } = options;

  const result: ImportResult = {
    setsProcessed: 0,
    setsInserted: 0,
    setsSkipped: 0,
    cardsProcessed: 0,
    cardsInserted: 0,
    cardsSkipped: 0,
    errors: [],
    skippedItems: []
  };

  console.log('🎯 Starting PriceCharting import process...');
  console.log(`📊 Limit: ${limit} cards per run`);
  console.log(`⏱️ Rate limit: ${rateLimitMs}ms between requests`);

  try {
    // Step 1: Fetch Marvel products (sets)
    const marvelProducts = await fetchMarvelProducts();
    
    if (marvelProducts.length === 0) {
      console.log('❌ No Marvel products found');
      return result;
    }

    let cardsProcessedCount = 0;
    
    // Step 2: Process each product (set)
    for (const product of marvelProducts) {
      if (cardsProcessedCount >= limit) {
        console.log(`🛑 Reached limit of ${limit} cards, stopping...`);
        break;
      }

      result.setsProcessed++;
      const setName = product['product-name'];
      
      console.log(`\n📦 Processing set: ${setName}`);
      
      // Check if set already exists
      const existingSet = await findExistingSet(setName);
      let setId: number;
      
      if (existingSet) {
        console.log(`⏭️ Set already exists: ${setName}`);
        result.setsSkipped++;
        result.skippedItems.push({
          type: 'set',
          name: setName,
          reason: 'Already exists in database'
        });
        setId = existingSet.id;
      } else {
        console.log(`➕ Creating new set: ${setName}`);
        const year = extractYear(setName);
        setId = await insertCardSet(setName, year);
        result.setsInserted++;
        console.log(`✅ Created set with ID: ${setId}`);
      }

      // Step 3: Fetch and process cards for this set
      try {
        const productCards = await fetchProductCards(product.id);
        console.log(`📋 Found ${productCards.length} cards for set: ${setName}`);
        
        for (const cardData of productCards) {
          if (cardsProcessedCount >= limit) {
            console.log(`🛑 Reached limit of ${limit} cards, stopping...`);
            break;
          }

          result.cardsProcessed++;
          cardsProcessedCount++;
          
          const cardName = formatCardName(cardData['product-name']);
          const cardNumber = extractCardNumber(cardData['product-name']);
          const price = cardData.price || 0;
          
          console.log(`\n🃏 Processing card: ${cardName} (#${cardNumber})`);
          
          // Check if card already exists
          const existingCard = await findExistingCard(setId, cardNumber);
          
          if (existingCard) {
            console.log(`⏭️ Card already exists: ${cardName} (#${cardNumber})`);
            result.cardsSkipped++;
            result.skippedItems.push({
              type: 'card',
              name: `${cardName} (#${cardNumber})`,
              reason: 'Already exists in database'
            });
          } else {
            console.log(`➕ Creating new card: ${cardName} (#${cardNumber})`);
            const cardId = await insertCard(
              setId,
              cardName,
              cardNumber,
              price,
              cardData.image_url
            );
            result.cardsInserted++;
            console.log(`✅ Created card with ID: ${cardId}`);
          }
          
          // Rate limiting
          if (cardsProcessedCount < limit) {
            console.log(`⏱️ Waiting ${rateLimitMs}ms before next request...`);
            await new Promise(resolve => setTimeout(resolve, rateLimitMs));
          }
        }
        
        // Update set card count
        await updateSetCardCount(setId);
        
      } catch (error) {
        const errorMsg = `Failed to process cards for set ${setName}: ${error instanceof Error ? error.message : error}`;
        console.error(`❌ ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    // Step 4: Write skipped items to log file
    if (result.skippedItems.length > 0) {
      const logPath = path.join(process.cwd(), logFile);
      fs.writeFileSync(logPath, JSON.stringify(result.skippedItems, null, 2));
      console.log(`📝 Skipped items logged to: ${logPath}`);
    }

    // Step 5: Final summary
    console.log('\n📈 PRICECHARTING IMPORT SUMMARY:');
    console.log(`📦 Sets processed: ${result.setsProcessed}`);
    console.log(`✅ Sets inserted: ${result.setsInserted}`);
    console.log(`⏭️ Sets skipped: ${result.setsSkipped}`);
    console.log(`🃏 Cards processed: ${result.cardsProcessed}`);
    console.log(`✅ Cards inserted: ${result.cardsInserted}`);
    console.log(`⏭️ Cards skipped: ${result.cardsSkipped}`);
    console.log(`❌ Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('\n🚨 ERRORS:');
      result.errors.forEach(error => console.log(`   - ${error}`));
    }

    return result;

  } catch (error) {
    const errorMsg = `Fatal error during PriceCharting import: ${error instanceof Error ? error.message : error}`;
    console.error(`💥 ${errorMsg}`);
    result.errors.push(errorMsg);
    return result;
  }
}

/**
 * Configuration validation
 */
function validateConfiguration(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!process.env.PRICECHARTING_API_TOKEN) {
    errors.push('PRICECHARTING_API_TOKEN environment variable is required');
  }
  
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    errors.push('CLOUDINARY_CLOUD_NAME environment variable is required');
  }
  
  if (!process.env.CLOUDINARY_API_KEY) {
    errors.push('CLOUDINARY_API_KEY environment variable is required');
  }
  
  if (!process.env.CLOUDINARY_API_SECRET) {
    errors.push('CLOUDINARY_API_SECRET environment variable is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Main execution function
 */
async function main() {
  console.log('🎯 Marvel Card Vault - PriceCharting Import Script');
  console.log('================================================\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const limit = args[0] ? parseInt(args[0]) : 50;
  const rateLimitMs = args[1] ? parseInt(args[1]) : 2000;
  
  if (isNaN(limit) || limit < 1) {
    console.error('❌ Invalid limit value. Please provide a positive number.');
    process.exit(1);
  }
  
  if (isNaN(rateLimitMs) || rateLimitMs < 1000) {
    console.error('❌ Invalid rate limit value. Please provide at least 1000ms.');
    process.exit(1);
  }
  
  // Validate configuration
  const config = validateConfiguration();
  if (!config.valid) {
    console.error('❌ Configuration Error:');
    console.error('   Missing required environment variables:');
    config.errors.forEach(error => console.error(`   - ${error}`));
    console.error('\nPlease add these to your .env file or environment variables.');
    process.exit(1);
  }
  
  console.log(`📊 Configuration:`);
  console.log(`   - Limit: ${limit} cards per run`);
  console.log(`   - Rate limit: ${rateLimitMs}ms between requests`);
  console.log(`   - Log file: pricecharting-import.log`);
  
  console.log('✅ Configuration check passed');
  console.log('🚀 Starting PriceCharting import...\n');
  
  try {
    const result = await importPriceChartingData({
      limit,
      rateLimitMs,
      logFile: 'pricecharting-import.log'
    });
    
    if (result.errors.length > 0) {
      console.log('\n⚠️ Import completed with errors. Check logs for details.');
      process.exit(1);
    } else {
      console.log('\n🎉 Import completed successfully!');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n💥 Fatal error during import:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
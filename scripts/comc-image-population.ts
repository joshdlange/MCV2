#!/usr/bin/env tsx
import { db } from "../server/db";
import { cards, cardSets } from "../shared/schema";
import { eq, isNull, or } from "drizzle-orm";
import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface COMCSearchResult {
  cardId: number;
  setName: string;
  cardName: string;
  cardNumber: string;
  imageUrl?: string;
  success: boolean;
  error?: string;
}

interface ProcessingStats {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  missCount: number;
}

/**
 * Get eBay OAuth2 Access Token
 */
async function getEBayAccessToken(): Promise<string | null> {
  try {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('❌ eBay OAuth credentials missing');
      return null;
    }

    const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    if (!response.ok) {
      console.error(`❌ eBay OAuth error: ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    console.log('✅ eBay OAuth token obtained successfully');
    return data.access_token;

  } catch (error) {
    console.error('❌ Error getting eBay access token:', error);
    return null;
  }
}

/**
 * Search COMC eBay store for a specific card using Browse API
 */
async function searchCOMCForCard(
  setName: string,
  cardName: string,
  cardNumber: string,
  accessToken: string
): Promise<string | null> {
  try {
    // Construct search query as specified
    const searchQuery = `${setName} ${cardName} ${cardNumber}`.replace(/\s+/g, ' ').trim();
    
    const browseApiUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
    const params = new URLSearchParams({
      'q': searchQuery,
      'filter': 'sellers:comc',  // This restricts to COMC store only
      'limit': '10',
      'fieldgroups': 'EXTENDED'
    });

    console.log(`🔍 COMC Search: "${searchQuery}"`);

    const response = await fetch(`${browseApiUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`❌ eBay Browse API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      console.log('📭 No items found in COMC store');
      return null;
    }

    // Extract the first available image from COMC results
    for (const item of data.itemSummaries) {
      if (item.image && item.image.imageUrl) {
        console.log(`✅ Found COMC image: ${item.image.imageUrl}`);
        return item.image.imageUrl;
      }
    }

    console.log('📭 No images found in COMC results');
    return null;

  } catch (error) {
    console.error('❌ COMC search error:', error);
    return null;
  }
}

/**
 * Search with loosened formatting (retry without card number)
 */
async function searchCOMCLoosened(
  setName: string,
  cardName: string,
  accessToken: string
): Promise<string | null> {
  try {
    // Try without card number
    const searchQuery = `${setName} ${cardName}`.replace(/\s+/g, ' ').trim();
    
    const browseApiUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
    const params = new URLSearchParams({
      'q': searchQuery,
      'filter': 'sellers:comc',
      'limit': '5',
      'fieldgroups': 'EXTENDED'
    });

    console.log(`🔍 COMC Retry (loosened): "${searchQuery}"`);

    const response = await fetch(`${browseApiUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      return null;
    }

    // Extract the first available image
    for (const item of data.itemSummaries) {
      if (item.image && item.image.imageUrl) {
        console.log(`✅ Found COMC image (loosened): ${item.image.imageUrl}`);
        return item.image.imageUrl;
      }
    }

    return null;

  } catch (error) {
    console.error('❌ COMC loosened search error:', error);
    return null;
  }
}

/**
 * Upload image to Cloudinary and get optimized URL
 */
async function uploadToCloudinary(imageUrl: string, cardId: number): Promise<string | null> {
  try {
    console.log(`☁️ Uploading to Cloudinary for card ${cardId}`);
    
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'marvel-cards',
      public_id: `card_${cardId}_${Date.now()}`,
      transformation: [
        { width: 500, height: 700, crop: 'limit' },
        { quality: 'auto' },
        { format: 'auto' }
      ]
    });

    console.log(`✅ Cloudinary upload successful: ${result.secure_url}`);
    return result.secure_url;

  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    return null;
  }
}

/**
 * Update card in database with new image URL
 */
async function updateCardImage(cardId: number, imageUrl: string): Promise<boolean> {
  try {
    await db
      .update(cards)
      .set({ frontImageUrl: imageUrl })
      .where(eq(cards.id, cardId));
    
    console.log(`✅ Database updated for card ${cardId}`);
    return true;

  } catch (error) {
    console.error(`❌ Database update error for card ${cardId}:`, error);
    return false;
  }
}

/**
 * Process a single card for COMC image population
 */
async function processCard(
  card: { id: number; name: string; cardNumber: string; setName: string },
  accessToken: string
): Promise<COMCSearchResult> {
  console.log(`\n🎯 Processing Card ${card.id}: ${card.name} (${card.cardNumber})`);
  
  try {
    // Step 1: Search COMC with full details
    let imageUrl = await searchCOMCForCard(card.setName, card.name, card.cardNumber, accessToken);
    
    // Step 2: If no result, try loosened search
    if (!imageUrl) {
      console.log('🔄 Trying loosened search...');
      imageUrl = await searchCOMCLoosened(card.setName, card.name, accessToken);
    }
    
    // Step 3: If still no result, log miss
    if (!imageUrl) {
      console.log(`📭 Miss logged for card ${card.id}`);
      return {
        cardId: card.id,
        setName: card.setName,
        cardName: card.name,
        cardNumber: card.cardNumber,
        success: false,
        error: 'No image found in COMC store'
      };
    }
    
    // Step 4: Upload to Cloudinary
    const cloudinaryUrl = await uploadToCloudinary(imageUrl, card.id);
    if (!cloudinaryUrl) {
      return {
        cardId: card.id,
        setName: card.setName,
        cardName: card.name,
        cardNumber: card.cardNumber,
        success: false,
        error: 'Failed to upload to Cloudinary'
      };
    }
    
    // Step 5: Update database
    const updateSuccess = await updateCardImage(card.id, cloudinaryUrl);
    if (!updateSuccess) {
      return {
        cardId: card.id,
        setName: card.setName,
        cardName: card.name,
        cardNumber: card.cardNumber,
        success: false,
        error: 'Failed to update database'
      };
    }
    
    console.log(`🎉 SUCCESS: Card ${card.id} updated with COMC image`);
    return {
      cardId: card.id,
      setName: card.setName,
      cardName: card.name,
      cardNumber: card.cardNumber,
      imageUrl: cloudinaryUrl,
      success: true
    };

  } catch (error) {
    console.error(`❌ Error processing card ${card.id}:`, error);
    return {
      cardId: card.id,
      setName: card.setName,
      cardName: card.name,
      cardNumber: card.cardNumber,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Find all cards missing images
 */
async function findCardsNeedingImages(limit?: number) {
  console.log('🔍 Finding cards missing images...');
  
  const query = db
    .select({
      id: cards.id,
      name: cards.name,
      cardNumber: cards.cardNumber,
      setName: cardSets.name,
    })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(
      or(
        isNull(cards.frontImageUrl),
        eq(cards.frontImageUrl, ''),
        eq(cards.frontImageUrl, '/images/image-coming-soon.png'),
        eq(cards.frontImageUrl, '/images/placeholder.png')
      )
    )
    .orderBy(cards.id);

  const result = limit ? await query.limit(limit) : await query;
  console.log(`📊 Found ${result.length} cards needing images`);
  return result;
}

/**
 * Main COMC image population function
 */
async function main() {
  console.log('🏪 COMC-Scoped eBay Image Population via Browse API');
  console.log('===================================================\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const limit = args[0] ? parseInt(args[0]) : undefined;
  const batchSize = args[1] ? parseInt(args[1]) : 50; // Default batch size
  
  if (limit && isNaN(limit)) {
    console.error('❌ Invalid limit value. Please provide a number.');
    process.exit(1);
  }
  
  console.log(`📊 Configuration:`);
  console.log(`   - Limit: ${limit || 'All cards'}`);
  console.log(`   - Batch size: ${batchSize}`);
  console.log(`   - Target: COMC eBay store only`);
  console.log(`   - Rate limit: 1000ms between requests\n`);
  
  // Check required environment variables
  const requiredVars = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    process.exit(1);
  }
  
  console.log('✅ Environment check passed\n');
  
  try {
    // Get eBay access token
    const accessToken = await getEBayAccessToken();
    if (!accessToken) {
      console.error('❌ Failed to get eBay access token');
      process.exit(1);
    }
    
    // Find cards needing images
    const cardsToProcess = await findCardsNeedingImages(limit);
    
    if (cardsToProcess.length === 0) {
      console.log('🎉 No cards need image updates!');
      return;
    }
    
    const stats: ProcessingStats = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      missCount: 0
    };
    
    const failures: COMCSearchResult[] = [];
    const misses: COMCSearchResult[] = [];
    
    console.log(`🚀 Starting COMC image population for ${cardsToProcess.length} cards...\n`);
    
    // Process cards in batches
    for (let i = 0; i < cardsToProcess.length; i += batchSize) {
      const batch = cardsToProcess.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(cardsToProcess.length / batchSize)} (${batch.length} cards)`);
      
      for (const card of batch) {
        const result = await processCard(card, accessToken);
        stats.totalProcessed++;
        
        if (result.success) {
          stats.successCount++;
        } else {
          stats.failureCount++;
          if (result.error === 'No image found in COMC store') {
            stats.missCount++;
            misses.push(result);
          } else {
            failures.push(result);
          }
        }
        
        // Rate limiting
        if (i + 1 < cardsToProcess.length) {
          console.log('⏱️ Rate limiting: waiting 1000ms...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Progress report
      const percent = Math.round((stats.totalProcessed / cardsToProcess.length) * 100);
      console.log(`📊 Progress: ${percent}% (${stats.totalProcessed}/${cardsToProcess.length}) - Success: ${stats.successCount}, Miss: ${stats.missCount}, Fail: ${stats.failureCount}\n`);
    }
    
    // Final report
    console.log('\n🎉 COMC IMAGE POPULATION COMPLETED!');
    console.log('=====================================');
    console.log(`📊 Total processed: ${stats.totalProcessed}`);
    console.log(`✅ Successful: ${stats.successCount}`);
    console.log(`📭 Misses (not in COMC): ${stats.missCount}`);
    console.log(`❌ Failures: ${stats.failureCount}`);
    
    const successRate = stats.totalProcessed > 0 ? 
      Math.round((stats.successCount / stats.totalProcessed) * 100) : 0;
    console.log(`📈 Success rate: ${successRate}%`);
    
    if (failures.length > 0) {
      console.log('\n❌ FAILURES (technical errors):');
      failures.slice(0, 10).forEach(failure => {
        console.log(`   - Card ${failure.cardId} (${failure.setName} - ${failure.cardName}): ${failure.error}`);
      });
      if (failures.length > 10) {
        console.log(`   ... and ${failures.length - 10} more failures`);
      }
    }
    
    if (misses.length > 0) {
      console.log('\n📭 MISSES (not found in COMC store):');
      misses.slice(0, 10).forEach(miss => {
        console.log(`   - Card ${miss.cardId}: ${miss.setName} - ${miss.cardName} ${miss.cardNumber}`);
      });
      if (misses.length > 10) {
        console.log(`   ... and ${misses.length - 10} more misses`);
      }
    }
    
  } catch (error) {
    console.error('\n💥 CRITICAL ERROR:', error);
    process.exit(1);
  }
}

// Handle script termination gracefully
process.on('SIGINT', () => {
  console.log('\n⏹️ Script interrupted by user. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️ Script terminated. Exiting...');
  process.exit(0);
});

// Run the script
main().catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
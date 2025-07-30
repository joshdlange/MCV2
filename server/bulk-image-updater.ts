import { db } from "./db";
import { cards, cardSets } from "@shared/schema";
import { eq, isNull, or, and, ne } from "drizzle-orm";
import { findAndUpdateCardImage } from "./ebay-image-finder";
import { searchCOMCForCard } from './comc-image-finder';

interface BulkUpdateResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successes: Array<{
    cardId: number;
    cardName: string;
    setName: string;
    newImageUrl: string;
  }>;
  failures: Array<{
    cardId: number;
    cardName: string;
    setName: string;
    error: string;
  }>;
  skipped: Array<{
    cardId: number;
    cardName: string;
    reason: string;
  }>;
}

interface BulkUpdateOptions {
  limit?: number;
  rateLimitMs?: number;
  onProgress?: (progress: {
    current: number;
    total: number;
    cardId: number;
    cardName: string;
    status: 'processing' | 'success' | 'failure' | 'skipped';
    message?: string;
  }) => void;
}

/**
 * Find all cards that need image updates
 */
export async function findCardsNeedingImages(limit?: number): Promise<Array<{
  id: number;
  name: string;
  cardNumber: string;
  setName: string;
  frontImageUrl: string | null;
  description: string | null;
}>> {
  console.log('🔍 Finding cards that need image updates...');
  
  try {
    const query = db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        setName: cardSets.name,
        frontImageUrl: cards.frontImageUrl,
        description: cards.description,
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
  } catch (error) {
    console.error('❌ Error finding cards needing images:', error);
    throw error;
  }
}

/**
 * Process a single card for image update
 */
async function processCard(card: {
  id: number;
  name: string;
  cardNumber: string;
  setName: string;
  frontImageUrl: string | null;
  description: string | null;
}): Promise<{ success: boolean; newImageUrl?: string; error?: string }> {
  try {
    console.log(`🏪 COMC Processing card ${card.id}: ${card.name} (${card.cardNumber})`);
    
    // Use COMC-specific search instead of general eBay search
    const result = await searchCOMCForCard(
      card.id,
      card.setName,
      card.name,
      card.cardNumber
    );
    
    if (result.success && result.newImageUrl) {
      console.log(`✅ COMC Updated card ${card.id} with new image`);
      return { success: true, newImageUrl: result.newImageUrl };
    } else {
      console.log(`📭 COMC No exact match for card ${card.id}: ${result.error || 'Unknown error'}`);
      return { success: false, error: result.error || 'No exact match found in COMC store' };
    }
  } catch (error) {
    console.error(`🚨 COMC Error processing card ${card.id}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Bulk update missing card images
 */
export async function bulkUpdateMissingImages(options: BulkUpdateOptions = {}): Promise<BulkUpdateResult> {
  const {
    limit,
    rateLimitMs = parseInt(process.env.EBAY_RATE_LIMIT_MS || '3000'),
    onProgress
  } = options;

  console.log('🚀 Starting bulk image update process...');
  console.log(`⚙️ Rate limit: ${rateLimitMs}ms between requests`);
  console.log(`📊 Limit: ${limit || 'No limit'}`);

  const result: BulkUpdateResult = {
    totalProcessed: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    successes: [],
    failures: [],
    skipped: []
  };

  try {
    // Step 1: Find cards needing images
    const cardsToUpdate = await findCardsNeedingImages(limit);
    
    if (cardsToUpdate.length === 0) {
      console.log('🎉 No cards need image updates!');
      return result;
    }

    console.log(`📋 Processing ${cardsToUpdate.length} cards...`);
    
    // Step 2: Process each card
    for (let i = 0; i < cardsToUpdate.length; i++) {
      const card = cardsToUpdate[i];
      result.totalProcessed++;
      
      // Progress callback
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: cardsToUpdate.length,
          cardId: card.id,
          cardName: card.name,
          status: 'processing'
        });
      }
      
      try {
        // Process the card
        const updateResult = await processCard(card);
        
        if (updateResult.success) {
          result.successCount++;
          result.successes.push({
            cardId: card.id,
            cardName: card.name,
            setName: card.setName,
            newImageUrl: updateResult.newImageUrl!
          });
          
          if (onProgress) {
            onProgress({
              current: i + 1,
              total: cardsToUpdate.length,
              cardId: card.id,
              cardName: card.name,
              status: 'success',
              message: `Updated with new image`
            });
          }
        } else {
          result.failureCount++;
          result.failures.push({
            cardId: card.id,
            cardName: card.name,
            setName: card.setName,
            error: updateResult.error || 'Unknown error'
          });
          
          if (onProgress) {
            onProgress({
              current: i + 1,
              total: cardsToUpdate.length,
              cardId: card.id,
              cardName: card.name,
              status: 'failure',
              message: updateResult.error || 'Unknown error'
            });
          }
        }
      } catch (error) {
        result.failureCount++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.failures.push({
          cardId: card.id,
          cardName: card.name,
          setName: card.setName,
          error: errorMsg
        });
        
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: cardsToUpdate.length,
            cardId: card.id,
            cardName: card.name,
            status: 'failure',
            message: errorMsg
          });
        }
      }
      
      // Rate limiting - wait between requests (always wait to be gentler on APIs)
      if (i < cardsToUpdate.length - 1) {
        console.log(`⏱️ Waiting ${rateLimitMs}ms before next request...`);
        await new Promise(resolve => setTimeout(resolve, rateLimitMs));
      }
      
      // Force garbage collection every 100 cards to prevent memory buildup
      if (i > 0 && i % 100 === 0) {
        console.log(`🧹 Memory cleanup at card ${i + 1}/${cardsToUpdate.length}`);
        if (global.gc) {
          global.gc();
        }
      }
    }

    // Step 3: Final summary
    console.log('\n📈 BULK UPDATE SUMMARY:');
    console.log(`📊 Total processed: ${result.totalProcessed}`);
    console.log(`✅ Successful updates: ${result.successCount}`);
    console.log(`❌ Failed updates: ${result.failureCount}`);
    console.log(`⏭️ Skipped: ${result.skippedCount}`);
    
    if (result.failures.length > 0) {
      console.log('\n❌ FAILED CARDS:');
      result.failures.forEach(failure => {
        console.log(`  - Card ${failure.cardId} (${failure.cardName}): ${failure.error}`);
      });
    }
    
    if (result.successes.length > 0) {
      console.log('\n✅ SUCCESSFUL UPDATES:');
      result.successes.forEach(success => {
        console.log(`  - Card ${success.cardId} (${success.cardName}): ${success.newImageUrl}`);
      });
    }

    return result;
  } catch (error) {
    console.error('🚨 Critical error during bulk update:', error);
    throw error;
  }
}

/**
 * Get configuration status for bulk update
 */
export function checkBulkUpdateConfiguration(): { 
  ready: boolean; 
  missingConfig: string[];
  rateLimitMs: number;
} {
  const missingConfig: string[] = [];
  
  if (!process.env.EBAY_CLIENT_ID) missingConfig.push('EBAY_CLIENT_ID');
  if (!process.env.EBAY_CLIENT_SECRET) missingConfig.push('EBAY_CLIENT_SECRET');
  if (!process.env.CLOUDINARY_CLOUD_NAME) missingConfig.push('CLOUDINARY_CLOUD_NAME');
  if (!process.env.CLOUDINARY_API_KEY) missingConfig.push('CLOUDINARY_API_KEY');
  if (!process.env.CLOUDINARY_API_SECRET) missingConfig.push('CLOUDINARY_API_SECRET');
  
  return {
    ready: missingConfig.length === 0,
    missingConfig,
    rateLimitMs: parseInt(process.env.EBAY_RATE_LIMIT_MS || '1000')
  };
}
import { db } from "./db";
import { cards, cardSets } from "@shared/schema";
import { eq, isNull, or, and, ne, desc, sql, not, ilike } from "drizzle-orm";
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
  skipRecentlyFailed?: boolean; // Skip cards that failed in the last 24 hours
  randomOrder?: boolean; // Process cards in random order instead of ID order
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
 * Find all cards that need image updates with smart retry logic
 */
export async function findCardsNeedingImages(
  limit?: number, 
  options: { 
    skipRecentlyFailed?: boolean; 
    randomOrder?: boolean; 
  } = {}
): Promise<Array<{
  id: number;
  name: string;
  cardNumber: string;
  setName: string;
  frontImageUrl: string | null;
  description: string | null;
}>> {
  console.log('🔍 Finding cards that need image updates...');
  
  try {
    // Build the base query
    let query = db
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
        and(
          or(
            isNull(cards.frontImageUrl),
            eq(cards.frontImageUrl, ''),
            eq(cards.frontImageUrl, '/images/image-coming-soon.png'),
            eq(cards.frontImageUrl, '/images/placeholder.png')
          ),
          // Apply skipRecentlyFailed logic if enabled (30 days) - only skip if updated_at exists and is recent
          options.skipRecentlyFailed ? 
            sql`(updated_at IS NULL OR updated_at < NOW() - INTERVAL '30 days')` : 
            sql`1=1`
        )
      );

    // Add ordering
    if (options.randomOrder) {
      query = query.orderBy(sql`RANDOM()`) as any;
    } else {
      // Order by highest ID first (newest cards) to avoid processing old failed cards
      query = query.orderBy(desc(cards.id)) as any;
    }
    
    // Add limit if specified
    const result = limit ? await (query as any).limit(limit) : await query;
    
    console.log(`📊 Found ${result.length} cards needing images`);
    if (options.randomOrder) {
      console.log('🎲 Using random order to avoid failed card clusters');
    } else {
      console.log('📈 Prioritizing newer cards to avoid repeatedly processing old failures');
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error finding cards needing images:', error);
    throw error;
  }
}

/**
 * Process a single card for image update with COMC → eBay fallback strategy
 */
async function processCard(card: {
  id: number;
  name: string;
  cardNumber: string;
  setName: string;
  frontImageUrl: string | null;
  description: string | null;
}): Promise<{ success: boolean; newImageUrl?: string; error?: string; source?: string }> {
  try {
    console.log(`Processing card ${card.id}: ${card.name} (${card.cardNumber}) from ${card.setName}`);
    
    // STRATEGY 1: Try COMC first (exact matches only)
    console.log(`🏪 COMC Search: "${card.setName} ${card.name} ${card.cardNumber}"`);
    const comcResult = await searchCOMCForCard(
      card.id,
      card.setName,
      card.name,
      card.cardNumber
    );
    
    if (comcResult.success && comcResult.newImageUrl) {
      console.log(`✅ SUCCESS via COMC for card ${card.id}`);
      return { 
        success: true, 
        newImageUrl: comcResult.newImageUrl,
        source: 'COMC'
      };
    }
    
    // STRATEGY 2: Fallback to original eBay search
    console.log(`🔍 COMC failed, trying general eBay search for card ${card.id}`);
    const ebayResult = await findAndUpdateCardImage(
      card.id,
      card.setName,
      card.name,
      card.cardNumber,
      card.description || undefined
    );
    
    if (ebayResult.success && ebayResult.newImageUrl) {
      console.log(`✅ SUCCESS via eBay fallback for card ${card.id}`);
      return { 
        success: true, 
        newImageUrl: ebayResult.newImageUrl,
        source: 'eBay'
      };
    }
    
    // Both strategies failed
    const errorMsg = `No images found via COMC or eBay for ${card.name}`;
    console.log(`❌ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
    
  } catch (error) {
    console.error(`🚨 Error processing card ${card.id}:`, error);
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
    skipRecentlyFailed = false,
    randomOrder = false,
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
    // Step 1: Find cards needing images with smart retry logic
    const cardsToUpdate = await findCardsNeedingImages(limit, { 
      skipRecentlyFailed, 
      randomOrder 
    });
    
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
          const source = (updateResult as any).source || 'Unknown';
          result.successes.push({
            cardId: card.id,
            cardName: card.name,
            setName: card.setName,
            newImageUrl: updateResult.newImageUrl!
          });
          
          console.log(`✅ SUCCESS via ${source} for card ${card.id}: ${card.name}`);
          
          if (onProgress) {
            onProgress({
              current: i + 1,
              total: cardsToUpdate.length,
              cardId: card.id,
              cardName: card.name,
              status: 'success',
              message: `Updated via ${source}`
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
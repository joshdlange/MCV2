import { db } from "./db";
import { cards, cardSets } from "../shared/schema";
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
    const PLACEHOLDER_URL = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';
    const RETRY_INTERVAL_DAYS = 30;
    
    // Smart ordering strategy:
    // 1. Cards NEVER searched (lastImageSearchAttempt is NULL) - ordered by newest card ID first
    // 2. Cards searched but failed long ago (>30 days) - ordered by oldest attempt first
    // This ensures newly imported cards are processed first, and old failures are retried eventually
    
    const baseCondition = or(
      isNull(cards.frontImageUrl),
      eq(cards.frontImageUrl, ''),
      eq(cards.frontImageUrl, '/images/image-coming-soon.png'),
      eq(cards.frontImageUrl, '/images/placeholder.png'),
      eq(cards.frontImageUrl, PLACEHOLDER_URL)
    );
    
    let whereCondition;
    if (options.skipRecentlyFailed) {
      // Only get cards that: have never been searched OR were searched more than 30 days ago
      whereCondition = and(
        baseCondition,
        or(
          isNull(cards.lastImageSearchAttempt),
          sql`${cards.lastImageSearchAttempt} < NOW() - INTERVAL '${sql.raw(String(RETRY_INTERVAL_DAYS))} days'`
        )
      );
    } else {
      whereCondition = baseCondition;
    }
    
    let query = db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        setName: cardSets.name,
        frontImageUrl: cards.frontImageUrl,
        description: cards.description,
        lastImageSearchAttempt: cards.lastImageSearchAttempt,
      })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(whereCondition);

    // Add ordering
    if (options.randomOrder) {
      query = query.orderBy(sql`RANDOM()`) as any;
    } else {
      // Smart priority queue:
      // 1. Cards NEVER searched (lastImageSearchAttempt IS NULL) - ordered by newest card ID first
      // 2. Cards searched long ago - ordered by OLDEST attempt first (so we retry cards that have waited the longest)
      // Using explicit NULLS FIRST for PostgreSQL clarity
      query = query.orderBy(
        sql`${cards.lastImageSearchAttempt} ASC NULLS FIRST`,  // NULLs first, then oldest attempts
        desc(cards.id)                                          // Within same group, newest cards first
      ) as any;
    }
    
    // Add limit if specified
    const result = limit ? await (query as any).limit(limit) : await query;
    
    const neverSearched = result.filter((c: any) => !c.lastImageSearchAttempt).length;
    const retries = result.length - neverSearched;
    
    console.log(`📊 Found ${result.length} cards needing images:`);
    console.log(`   🆕 ${neverSearched} never searched (prioritized)`);
    console.log(`   🔄 ${retries} to retry (searched >30 days ago)`);
    
    if (options.randomOrder) {
      console.log('🎲 Using random order');
    } else {
      console.log('📈 Smart priority: new cards first, then oldest retries');
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
    skipRecentlyFailed = true,  // Default to true - always skip cards searched recently
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
        
        // ALWAYS update lastImageSearchAttempt after each search attempt (success or failure)
        // This ensures we don't keep retrying the same cards repeatedly
        await db.update(cards)
          .set({ lastImageSearchAttempt: new Date() })
          .where(eq(cards.id, card.id));
        
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
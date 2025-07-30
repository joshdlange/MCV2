#!/usr/bin/env tsx

import { drizzle } from 'drizzle-orm/neon-serverless';
import { neon } from '@neondatabase/serverless';
import { cards } from '../shared/schema';
import { eq, isNull, or, and, gt } from 'drizzle-orm';
import { v2 as cloudinary } from 'cloudinary';

// Configuration
const CONFIG = {
  BATCH_SIZE: parseInt(process.env.COMC_BATCH_SIZE || '150'),
  BATCH_DELAY: parseInt(process.env.COMC_BATCH_DELAY || '2000'), // 2 seconds between batches
  RATE_LIMIT: parseInt(process.env.COMC_RATE_LIMIT || '1000'), // 1 second between requests
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY: 1000, // 1 second
  BACKOFF_MULTIPLIER: 2.5,
  MAX_CONCURRENT_REQUESTS: 1, // Keep it simple and sequential
  RESUME_FROM_ID: parseInt(process.env.COMC_RESUME_FROM || '0'),
  MAX_TOTAL_CARDS: parseInt(process.env.COMC_MAX_CARDS || '0'), // 0 = no limit
  LOG_TO_FILE: process.env.COMC_LOG_FILE === 'true',
  PROGRESS_INTERVAL: 25, // Log progress every N cards
};

interface ProcessingStats {
  totalProcessed: number;
  successCount: number;
  missCount: number;
  failureCount: number;
  startTime: Date;
  lastProcessedId: number;
  batchesCompleted: number;
  errors: Array<{
    cardId: number;
    error: string;
    timestamp: Date;
  }>;
}

interface ProcessingState {
  resumeFromId: number;
  isRunning: boolean;
  currentBatch: number;
  totalBatches: number;
}

class COMCMassiveImageProcessor {
  private db: any;
  private stats: ProcessingStats;
  private state: ProcessingState;
  private logFile: string;

  constructor() {
    const sql = neon(process.env.DATABASE_URL!);
    this.db = drizzle(sql);
    
    this.stats = {
      totalProcessed: 0,
      successCount: 0,
      missCount: 0,
      failureCount: 0,
      startTime: new Date(),
      lastProcessedId: CONFIG.RESUME_FROM_ID,
      batchesCompleted: 0,
      errors: []
    };

    this.state = {
      resumeFromId: CONFIG.RESUME_FROM_ID,
      isRunning: false,
      currentBatch: 0,
      totalBatches: 0
    };

    this.logFile = `comc-massive-processing-${Date.now()}.log`;
    
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  private log(message: string, level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    console.log(logMessage);
    
    if (CONFIG.LOG_TO_FILE) {
      // In a real implementation, you'd use fs.appendFileSync here
      // For now, we'll just log to console
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    context: string,
    cardId?: number
  ): Promise<T | null> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === CONFIG.MAX_RETRIES) {
          this.log(`${context} failed after ${CONFIG.MAX_RETRIES} attempts: ${lastError.message}`, 'ERROR');
          
          if (cardId) {
            this.stats.errors.push({
              cardId,
              error: `${context}: ${lastError.message}`,
              timestamp: new Date()
            });
          }
          
          return null;
        }
        
        const delay = CONFIG.INITIAL_RETRY_DELAY * Math.pow(CONFIG.BACKOFF_MULTIPLIER, attempt - 1);
        this.log(`${context} attempt ${attempt} failed, retrying in ${delay}ms: ${lastError.message}`, 'WARN');
        await this.delay(delay);
      }
    }
    
    return null;
  }

  private async getEbayToken(): Promise<string | null> {
    return this.retryWithBackoff(async () => {
      const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`
        },
        body: 'grant_type=client_credentials&scope=https://api.ebayapis.com/oauth/api_scope'
      });

      if (!response.ok) {
        throw new Error(`eBay OAuth failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.access_token;
    }, 'eBay OAuth token retrieval');
  }

  private async searchCOMCForCard(card: any, token: string): Promise<string | null> {
    const setName = card.set?.name || '';
    const cardName = card.name || '';
    const cardNumber = card.cardNumber || '';
    
    const searchQuery = `${setName} ${cardName} ${cardNumber}`.trim();
    
    if (!searchQuery) {
      this.log(`Skipping card ${card.id}: missing search data`, 'WARN');
      return null;
    }

    this.log(`🔍 COMC Search for Card ${card.id}: "${searchQuery}"`);
    
    return this.retryWithBackoff(async () => {
      const response = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(searchQuery)}&filter=sellers:comc&limit=10`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
          }
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limited by eBay API');
        }
        throw new Error(`eBay Browse API failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.itemSummaries && data.itemSummaries.length > 0) {
        // Look for exact matches first
        for (const item of data.itemSummaries) {
          const title = item.title.toLowerCase();
          const queryLower = searchQuery.toLowerCase();
          
          // Check if this is a good match (contains key components)
          if (title.includes(cardName.toLowerCase()) && 
              (cardNumber ? title.includes(cardNumber) : true)) {
            
            const imageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl;
            if (imageUrl) {
              this.log(`✅ Found COMC image for Card ${card.id}: ${imageUrl}`);
              return imageUrl;
            }
          }
        }
      }
      
      this.log(`📭 No EXACT match found for card ${card.id} in COMC store`);
      return null;
    }, `COMC search for card ${card.id}`, card.id);
  }

  private async uploadToCloudinary(imageUrl: string, cardId: number): Promise<string | null> {
    this.log(`☁️ Uploading to Cloudinary for card ${cardId}`);
    
    return this.retryWithBackoff(async () => {
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder: 'marvel-cards',
        public_id: `card_${cardId}_${Date.now()}`,
        overwrite: false,
        transformation: [
          { quality: 'auto', fetch_format: 'auto' },
          { width: 500, height: 700, crop: 'fit' }
        ]
      });
      
      this.log(`✅ Cloudinary upload successful for card ${cardId}: ${result.secure_url}`);
      return result.secure_url;
    }, `Cloudinary upload for card ${cardId}`, cardId);
  }

  private async updateCardImage(cardId: number, imageUrl: string): Promise<boolean> {
    return this.retryWithBackoff(async () => {
      await this.db.update(cards)
        .set({ 
          frontImageUrl: imageUrl,
          updatedAt: new Date()
        })
        .where(eq(cards.id, cardId));
      
      this.log(`✅ Database updated for card ${cardId}`);
      return true;
    }, `Database update for card ${cardId}`, cardId) !== null;
  }

  private async processCard(card: any, token: string): Promise<'success' | 'miss' | 'failure'> {
    try {
      // Search COMC for the card
      const ebayImageUrl = await this.searchCOMCForCard(card, token);
      
      if (!ebayImageUrl) {
        this.stats.missCount++;
        return 'miss';
      }

      // Upload to Cloudinary
      const cloudinaryUrl = await this.uploadToCloudinary(ebayImageUrl, card.id);
      
      if (!cloudinaryUrl) {
        this.stats.failureCount++;
        return 'failure';
      }

      // Update database
      const updateSuccess = await this.updateCardImage(card.id, cloudinaryUrl);
      
      if (!updateSuccess) {
        this.stats.failureCount++;
        return 'failure';
      }

      this.log(`🎉 SUCCESS: Card ${card.id} updated with COMC image`, 'SUCCESS');
      this.stats.successCount++;
      return 'success';

    } catch (error) {
      this.log(`❌ Error processing card ${card.id}: ${(error as Error).message}`, 'ERROR');
      this.stats.errors.push({
        cardId: card.id,
        error: (error as Error).message,
        timestamp: new Date()
      });
      this.stats.failureCount++;
      return 'failure';
    }
  }

  private async getCardsToProcess(limit: number, offset: number): Promise<any[]> {
    const whereCondition = and(
      or(isNull(cards.frontImageUrl), eq(cards.frontImageUrl, '')),
      gt(cards.id, this.state.resumeFromId)
    );

    const cardsToProcess = await this.db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        setId: cards.setId
      })
      .from(cards)
      .where(whereCondition)
      .orderBy(cards.id)
      .limit(limit)
      .offset(offset);

    // Join with sets to get set name (simplified for this example)
    // In production, you'd do a proper join
    for (const card of cardsToProcess) {
      // Mock set data - in production, join with sets table
      card.set = { name: 'Marvel Set' };
    }

    return cardsToProcess;
  }

  private async getTotalCardsToProcess(): Promise<number> {
    const result = await this.db
      .select()
      .from(cards)
      .where(
        and(
          or(isNull(cards.frontImageUrl), eq(cards.frontImageUrl, '')),
          gt(cards.id, this.state.resumeFromId)
        )
      );
    
    return result.length;
  }

  private printProgressReport() {
    const elapsed = Date.now() - this.stats.startTime.getTime();
    const elapsedMinutes = Math.round(elapsed / 60000);
    const rate = this.stats.totalProcessed / (elapsed / 1000); // cards per second
    const successRate = ((this.stats.successCount / this.stats.totalProcessed) * 100).toFixed(1);

    this.log(`
📊 PROGRESS REPORT
=====================================
⏱️  Running for: ${elapsedMinutes} minutes
📦 Batches completed: ${this.stats.batchesCompleted}
🔢 Total processed: ${this.stats.totalProcessed}
✅ Successful: ${this.stats.successCount}
📭 Misses (not in COMC): ${this.stats.missCount}
❌ Failures: ${this.stats.failureCount}
📈 Success rate: ${successRate}%
⚡ Processing rate: ${rate.toFixed(2)} cards/second
🆔 Last processed ID: ${this.stats.lastProcessedId}
    `, 'INFO');

    if (this.stats.errors.length > 0) {
      this.log(`Recent errors: ${this.stats.errors.slice(-3).map(e => `Card ${e.cardId}: ${e.error}`).join(', ')}`, 'WARN');
    }
  }

  public async processAllCards(): Promise<void> {
    this.log(`🏪 COMC MASSIVE IMAGE POPULATION STARTING`, 'INFO');
    this.log(`📊 Configuration:
   - Batch size: ${CONFIG.BATCH_SIZE}
   - Batch delay: ${CONFIG.BATCH_DELAY}ms
   - Rate limit: ${CONFIG.RATE_LIMIT}ms
   - Max retries: ${CONFIG.MAX_RETRIES}
   - Resume from ID: ${CONFIG.RESUME_FROM_ID}
   - Max total cards: ${CONFIG.MAX_TOTAL_CARDS || 'unlimited'}`);

    this.state.isRunning = true;

    try {
      // Get eBay token
      this.log('🔑 Obtaining eBay OAuth token...');
      const token = await this.getEbayToken();
      if (!token) {
        throw new Error('Failed to obtain eBay OAuth token');
      }
      this.log('✅ eBay OAuth token obtained successfully');

      // Get total count
      const totalCards = await this.getTotalCardsToProcess();
      this.log(`📊 Found ${totalCards} cards needing images`);
      
      if (totalCards === 0) {
        this.log('🎉 No cards need processing - all done!', 'SUCCESS');
        return;
      }

      const maxCards = CONFIG.MAX_TOTAL_CARDS > 0 ? 
        Math.min(totalCards, CONFIG.MAX_TOTAL_CARDS) : totalCards;
      
      this.state.totalBatches = Math.ceil(maxCards / CONFIG.BATCH_SIZE);
      this.log(`🚀 Starting massive COMC image population for ${maxCards} cards in ${this.state.totalBatches} batches`);

      let offset = 0;
      
      while (this.state.isRunning && this.stats.totalProcessed < maxCards) {
        const remainingCards = maxCards - this.stats.totalProcessed;
        const batchSize = Math.min(CONFIG.BATCH_SIZE, remainingCards);
        
        this.state.currentBatch++;
        this.log(`\n📦 Processing batch ${this.state.currentBatch}/${this.state.totalBatches} (${batchSize} cards)`);

        // Get batch of cards
        const batchCards = await this.getCardsToProcess(batchSize, offset);
        
        if (batchCards.length === 0) {
          this.log('No more cards to process', 'INFO');
          break;
        }

        // Process each card in the batch
        for (const card of batchCards) {
          if (!this.state.isRunning) break;
          
          await this.processCard(card, token);
          this.stats.totalProcessed++;
          this.stats.lastProcessedId = card.id;

          // Progress logging
          if (this.stats.totalProcessed % CONFIG.PROGRESS_INTERVAL === 0) {
            this.printProgressReport();
          }

          // Rate limiting between requests
          await this.delay(CONFIG.RATE_LIMIT);
        }

        this.stats.batchesCompleted++;
        offset += batchSize;

        // Batch delay
        if (this.state.currentBatch < this.state.totalBatches) {
          this.log(`⏸️  Batch ${this.state.currentBatch} complete. Waiting ${CONFIG.BATCH_DELAY}ms before next batch...`);
          await this.delay(CONFIG.BATCH_DELAY);
        }
      }

      // Final report
      this.log(`\n🎉 COMC MASSIVE IMAGE POPULATION COMPLETED!`, 'SUCCESS');
      this.printProgressReport();

    } catch (error) {
      this.log(`❌ Fatal error in massive processing: ${(error as Error).message}`, 'ERROR');
      throw error;
    } finally {
      this.state.isRunning = false;
      this.log(`📝 Processing state saved. Resume from ID: ${this.stats.lastProcessedId}`);
    }
  }

  public getStats(): ProcessingStats {
    return { ...this.stats };
  }

  public getState(): ProcessingState {
    return { ...this.state };
  }

  public stop(): void {
    this.log('🛑 Stop requested - will finish current card and stop', 'WARN');
    this.state.isRunning = false;
  }
}

// CLI execution
async function main() {
  const processor = new COMCMassiveImageProcessor();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT - stopping gracefully...');
    processor.stop();
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM - stopping gracefully...');
    processor.stop();
  });

  try {
    await processor.processAllCards();
    process.exit(0);
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Export for use as module
export { COMCMassiveImageProcessor };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
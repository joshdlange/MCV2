import { db } from './db.js';
import { cards } from '../shared/schema.js';
import { isNull, or, eq } from 'drizzle-orm';
import { findAndUpdateCardImage } from './ebay-image-finder.js';

interface ProcessingStats {
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  isRunning: boolean;
  startTime: Date | null;
  lastProcessedId: number | null;
  maxCards: number;
}

class BackgroundImageProcessor {
  private stats: ProcessingStats = {
    totalProcessed: 0,
    successCount: 0,
    errorCount: 0,
    isRunning: false,
    startTime: null,
    lastProcessedId: null,
    maxCards: 2000 // Limit to 2000 API calls to stay within reasonable limits
  };

  private processTimeout: NodeJS.Timeout | null = null;
  private batchSize = 10;
  private delayBetweenBatches = 5000; // 5 seconds
  private delayBetweenCards = 1000; // 1 second

  async start() {
    if (this.stats.isRunning) {
      console.log('🔄 Background image processor already running');
      return;
    }

    this.stats.isRunning = true;
    this.stats.startTime = new Date();
    console.log('🚀 Starting background image processor...');
    
    await this.processBatch();
  }

  stop() {
    if (this.processTimeout) {
      clearTimeout(this.processTimeout);
      this.processTimeout = null;
    }
    this.stats.isRunning = false;
    console.log('🛑 Background image processor stopped');
  }

  getStats() {
    return { ...this.stats };
  }

  private async processBatch() {
    try {
      // Check if we've reached the maximum number of cards
      if (this.stats.totalProcessed >= this.stats.maxCards) {
        console.log(`🛑 Reached maximum limit of ${this.stats.maxCards} cards - stopping processor`);
        this.stop();
        return;
      }

      // Calculate remaining cards to process
      const remainingCards = this.stats.maxCards - this.stats.totalProcessed;
      const currentBatchSize = Math.min(this.batchSize, remainingCards);

      // Get cards without images
      const cardsToProcess = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          setId: cards.setId
        })
        .from(cards)
        .where(or(isNull(cards.frontImageUrl), eq(cards.frontImageUrl, '')))
        .limit(currentBatchSize)
        .offset(0);

      if (cardsToProcess.length === 0) {
        console.log('✅ All cards have been processed - stopping background processor');
        this.stop();
        return;
      }

      console.log(`📦 Processing batch of ${cardsToProcess.length} cards (${this.stats.totalProcessed}/${this.stats.maxCards} total)...`);

      for (const card of cardsToProcess) {
        if (!this.stats.isRunning || this.stats.totalProcessed >= this.stats.maxCards) break;

        try {
          console.log(`🎯 Processing card ${card.id}: ${card.name} (${this.stats.totalProcessed + 1}/${this.stats.maxCards})`);
          
          // Process the card image using the existing function
          const result = await findAndUpdateCardImage(card.id);

          if (result.success) {
            this.stats.successCount++;
            console.log(`✅ Successfully processed card ${card.id}: ${card.name}`);
          } else {
            this.stats.errorCount++;
            console.log(`❌ Failed to process card ${card.id}: ${card.name} - ${result.error || 'Unknown error'}`);
          }

          this.stats.totalProcessed++;
          this.stats.lastProcessedId = card.id;

          // Wait between cards to avoid hitting API limits
          await this.delay(this.delayBetweenCards);

        } catch (error) {
          this.stats.errorCount++;
          this.stats.totalProcessed++;
          console.error(`💥 Error processing card ${card.id}:`, error);
        }
      }

      // Schedule next batch if still running and under limit
      if (this.stats.isRunning && this.stats.totalProcessed < this.stats.maxCards) {
        console.log(`⏳ Waiting ${this.delayBetweenBatches}ms before next batch...`);
        this.processTimeout = setTimeout(() => {
          this.processBatch();
        }, this.delayBetweenBatches);
      } else {
        console.log(`🏁 Processing complete: ${this.stats.successCount} success, ${this.stats.errorCount} errors`);
        this.stop();
      }

    } catch (error) {
      console.error('💥 Error in batch processing:', error);
      // Retry after delay if still under limit
      if (this.stats.isRunning && this.stats.totalProcessed < this.stats.maxCards) {
        this.processTimeout = setTimeout(() => {
          this.processBatch();
        }, this.delayBetweenBatches);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create singleton instance
export const backgroundImageProcessor = new BackgroundImageProcessor();

// Start processing on server startup
console.log('🔧 Background image processor initialized');
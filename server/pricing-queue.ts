import { db } from './db';
import { cards, userCollections, cardSets } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { ebayPricingService } from './ebay-pricing';

interface PricingJob {
  cardId: number;
  priority: number; // 1 = user-owned (highest), 2 = trending, 3 = general
}

class PricingQueue {
  private queue: PricingJob[] = [];
  private isProcessing = false;
  private readonly maxJobsPerHour = 30;
  private processedThisHour = 0;
  private hourlyResetTime = Date.now() + (60 * 60 * 1000);

  /**
   * Add a card to the pricing queue
   */
  addToQueue(cardId: number, priority: number = 3) {
    // Check if already in queue
    if (this.queue.some(job => job.cardId === cardId)) {
      return;
    }

    this.queue.push({ cardId, priority });
    this.queue.sort((a, b) => a.priority - b.priority); // Sort by priority (lower = higher priority)
    
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process the pricing queue
   */
  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && this.canProcessMore()) {
      const job = this.queue.shift();
      if (!job) break;

      try {
        console.log(`Processing pricing for card ${job.cardId} (priority ${job.priority})`);
        await ebayPricingService.fetchAndCacheCardPricing(job.cardId);
        this.processedThisHour++;
        
        // Wait between jobs to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`Failed to process pricing for card ${job.cardId}:`, error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Check if we can process more jobs this hour
   */
  private canProcessMore(): boolean {
    const now = Date.now();
    
    // Reset hourly counter
    if (now > this.hourlyResetTime) {
      this.processedThisHour = 0;
      this.hourlyResetTime = now + (60 * 60 * 1000);
    }

    return this.processedThisHour < this.maxJobsPerHour;
  }

  /**
   * Queue pricing updates for user-owned cards (highest priority)
   */
  async queueUserOwnedCards(userId: number) {
    try {
      const userCards = await db
        .select({ cardId: userCollections.cardId })
        .from(userCollections)
        .where(eq(userCollections.userId, userId));

      for (const { cardId } of userCards) {
        this.addToQueue(cardId, 1); // Priority 1 for user-owned
      }
    } catch (error) {
      console.error('Error queuing user-owned cards:', error);
    }
  }

  /**
   * Queue trending cards for pricing updates
   */
  async queueTrendingCards() {
    try {
      // Get trending cards (cards that appear most in collections)
      const trendingCards = await db
        .select({ cardId: cards.id })
        .from(cards)
        .limit(20);

      for (const { cardId } of trendingCards) {
        this.addToQueue(cardId, 2); // Priority 2 for trending
      }
    } catch (error) {
      console.error('Error queuing trending cards:', error);
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      processedThisHour: this.processedThisHour,
      maxPerHour: this.maxJobsPerHour
    };
  }
}

export const pricingQueue = new PricingQueue();

// Start background processing of trending cards every hour
setInterval(() => {
  pricingQueue.queueTrendingCards();
}, 60 * 60 * 1000); // Every hour
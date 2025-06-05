import { ebayPricingService } from './ebay-pricing.js';
import { storage } from './storage.js';

/**
 * Background pricing service to automatically refresh stale pricing data
 * Runs every 6 hours to stay within eBay API limits
 */
class BackgroundPricingService {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly refreshIntervalHours = 6; // Every 6 hours
  private readonly maxCardsPerRun = 25; // Stay well under eBay limits

  /**
   * Start the background pricing service
   */
  start() {
    if (this.isRunning) {
      console.log('Background pricing service is already running');
      return;
    }

    console.log(`Starting background pricing service - refreshing every ${this.refreshIntervalHours} hours`);
    this.isRunning = true;

    // Run immediately on startup
    this.runPricingUpdate().catch(console.error);

    // Schedule regular updates
    this.intervalId = setInterval(() => {
      this.runPricingUpdate().catch(console.error);
    }, this.refreshIntervalHours * 60 * 60 * 1000);
  }

  /**
   * Stop the background pricing service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('Background pricing service stopped');
  }

  /**
   * Run a single pricing update cycle
   */
  private async runPricingUpdate() {
    try {
      console.log('Background pricing update starting...');
      
      // Get cards that need pricing updates (stale or never fetched)
      const cardsNeedingUpdate = await this.getCardsNeedingPricing();
      
      if (cardsNeedingUpdate.length === 0) {
        console.log('No cards need pricing updates at this time');
        return;
      }

      // Limit to prevent hitting API limits
      const cardsToUpdate = cardsNeedingUpdate.slice(0, this.maxCardsPerRun);
      console.log(`Updating pricing for ${cardsToUpdate.length} cards (${cardsNeedingUpdate.length} total need updates)`);

      // Update pricing in batches to respect rate limits
      await ebayPricingService.updatePricingForCards(cardsToUpdate);
      
      console.log(`Background pricing update completed for ${cardsToUpdate.length} cards`);
    } catch (error) {
      console.error('Error in background pricing update:', error);
    }
  }

  /**
   * Get cards that need pricing updates
   * Priority: 1. User-owned cards, 2. Popular cards, 3. Cards never priced
   */
  private async getCardsNeedingPricing(): Promise<number[]> {
    try {
      // Get cards that are stale (older than 24 hours) or never priced
      const staleCards = await storage.getCardsWithStalePricing();
      
      // Get popular cards from user collections (highest priority)
      const popularCards = await storage.getPopularCardsFromCollections();
      
      // Combine and deduplicate, prioritizing popular cards
      const cardSet = new Set<number>();
      
      // Add popular cards first (highest priority)
      popularCards.forEach(cardId => cardSet.add(cardId));
      
      // Add stale cards
      staleCards.forEach(cardId => cardSet.add(cardId));
      
      return Array.from(cardSet);
    } catch (error) {
      console.error('Error getting cards needing pricing:', error);
      return [];
    }
  }

  /**
   * Get current service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      refreshIntervalHours: this.refreshIntervalHours,
      maxCardsPerRun: this.maxCardsPerRun,
      nextRunTime: this.intervalId ? 
        new Date(Date.now() + this.refreshIntervalHours * 60 * 60 * 1000) : 
        null
    };
  }

  /**
   * Manually trigger a pricing update (for admin use)
   */
  async triggerManualUpdate() {
    if (this.isRunning) {
      console.log('Manual pricing update triggered');
      await this.runPricingUpdate();
    } else {
      throw new Error('Background pricing service is not running');
    }
  }
}

export const backgroundPricingService = new BackgroundPricingService();

/**
 * Initialize background pricing service
 */
export function startBackgroundPricing() {
  backgroundPricingService.start();
}

/**
 * Stop background pricing service
 */
export function stopBackgroundPricing() {
  backgroundPricingService.stop();
}
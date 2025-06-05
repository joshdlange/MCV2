import { db } from "./db";
import { cards, cardPriceCache, cardSets } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";

interface EbaySoldItem {
  title: string;
  soldPrice: number;
  condition: string;
  endTime: string;
  viewItemURL: string;
}

interface EbayApiResponse {
  findCompletedItemsResponse: [{
    ack: string[];
    searchResult: [{
      count: string;
      item?: EbaySoldItem[];
    }];
  }];
}

export class EbayPricingService {
  private readonly appId: string;
  private readonly baseUrl = 'https://svcs.ebay.com/services/search/FindingService/v1';
  private lastRequestTime: number = 0;
  private readonly minRequestInterval = 3000; // 3 seconds between requests
  private requestCount: number = 0;
  private readonly maxRequestsPerHour = 70; // Increased limit but stay under eBay's limits
  private hourlyResetTime: number = Date.now() + (60 * 60 * 1000); // Reset every hour
  private failedRequests: Set<number> = new Set(); // Track failed card IDs for retry
  
  constructor() {
    // Use production keys if available, otherwise fall back to sandbox
    this.appId = process.env.EBAY_APP_ID_PROD || process.env.EBAY_APP_ID || '';
    if (!this.appId) {
      throw new Error('EBAY_APP_ID_PROD or EBAY_APP_ID environment variable is required');
    }
    console.log('eBay Pricing Service initialized with:', this.appId.startsWith('JoshLan') ? 'PRODUCTION' : 'SANDBOX', 'credentials');
  }

  /**
   * Check and enforce hourly rate limits
   */
  private canMakeRequest(): boolean {
    const now = Date.now();
    
    // Reset hourly counter if needed
    if (now > this.hourlyResetTime) {
      this.requestCount = 0;
      this.hourlyResetTime = now + (60 * 60 * 1000);
      console.log('eBay API rate limit counter reset');
    }
    
    return this.requestCount < this.maxRequestsPerHour;
  }

  /**
   * Rate limiting helper to prevent hitting eBay API limits
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`Rate limiting: waiting ${waitTime}ms before next eBay API call`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Exponential backoff retry helper
   */
  private async retryWithExponentialBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 2000
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          console.error(`Operation failed after ${maxRetries + 1} attempts:`, lastError.message);
          throw lastError;
        }
        
        const delay = baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s
        console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Get cached price as fallback when API fails
   */
  private async getCachedPriceAsFallback(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null> {
    try {
      const [cachedPrice] = await db
        .select()
        .from(cardPriceCache)
        .where(eq(cardPriceCache.cardId, cardId))
        .limit(1);

      if (cachedPrice) {
        console.log(`Using cached price as fallback for card ${cardId}`);
        return {
          avgPrice: parseFloat(cachedPrice.avgPrice || '0'),
          salesCount: cachedPrice.salesCount || 0,
          lastFetched: cachedPrice.lastFetched
        };
      }
    } catch (error) {
      console.error(`Error getting cached price for card ${cardId}:`, error);
    }
    
    return null;
  }

  /**
   * Build multiple search query variations for a Marvel card
   */
  private buildSearchQueries(setName: string, cardName: string, cardNumber: string): string[] {
    // Extract year from set name
    const yearMatch = setName.match(/(\d{4})/);
    const year = yearMatch ? yearMatch[1] : '';
    
    // Clean card name - remove special characters but keep spaces
    const cleanCardName = cardName.replace(/[^\w\s-]/g, '').trim();
    
    console.log(`Building eBay search queries for: "${cardName}" from "${setName}" #${cardNumber}`);
    
    // Build tiered queries based on successful eBay search pattern
    const queries: string[] = [];
    
    // Query 1: Full pattern like the successful example - "Year Set Name Character #Number"
    if (year) {
      queries.push(`${year} ${setName} ${cleanCardName} #${cardNumber}`);
    }
    
    // Query 2: Set name + character + card number without year
    queries.push(`${setName} ${cleanCardName} #${cardNumber}`);
    
    // Query 3: Year + character + Marvel + card number
    if (year) {
      queries.push(`${year} ${cleanCardName} Marvel #${cardNumber}`);
    }
    
    // Query 4: Character + Marvel + card number (more general)
    queries.push(`${cleanCardName} Marvel #${cardNumber}`);
    
    // Query 5: Fallback - just character + Marvel (broadest)
    queries.push(`${cleanCardName} Marvel`);
    
    console.log(`Generated ${queries.length} query variations:`, queries);
    return queries;
  }

  /**
   * Fetch completed listings from eBay using multiple query attempts
   */
  private async fetchCompletedListings(queries: string[]): Promise<EbaySoldItem[]> {
    for (const searchQuery of queries) {
      console.log(`Trying eBay search: "${searchQuery}"`);
      const results = await this.fetchSingleQuery(searchQuery);
      
      if (results.length > 0) {
        console.log(`Found ${results.length} results for query: "${searchQuery}"`);
        return results.slice(0, 10); // Take top 10 results for filtering
      }
    }
    
    console.log('No results found for any query variations');
    return [];
  }

  /**
   * Fetch completed listings for a single search query with retry logic
   */
  private async fetchSingleQuery(searchQuery: string): Promise<EbaySoldItem[]> {
    return this.retryWithExponentialBackoff(async () => {
      // Correct eBay Finding API headers (SOA format, not REST)
      const headers = {
        'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
        'X-EBAY-SOA-SERVICE-VERSION': '1.0.0',
        'X-EBAY-SOA-SECURITY-APPNAME': this.appId,
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
      };

      // Query parameters for the request
      const params = new URLSearchParams({
        'keywords': searchQuery,
        'categoryId': '2536', // Non-Sport Trading Cards
        'itemFilter(0).name': 'SoldItemsOnly',
        'itemFilter(0).value': 'true',
        'itemFilter(1).name': 'ListingType',
        'itemFilter(1).value': 'AuctionWithBIN',
        'itemFilter(2).name': 'ListingType',
        'itemFilter(2).value': 'FixedPrice',
        'sortOrder': 'EndTimeSoonest',
        'paginationInput.entriesPerPage': '10'
      });

      // Apply rate limiting
      await this.waitForRateLimit();
      
      console.log('eBay API Request URL:', `${this.baseUrl}?${params.toString()}`);
      console.log('eBay API Headers:', headers);
      
      const response = await fetch(`${this.baseUrl}?${params}`, {
        method: 'GET',
        headers: headers
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`eBay API Error Response for query "${searchQuery}":`, errorText);
        
        // Check for rate limit error
        if (errorText.includes('exceeded the number of times')) {
          console.warn('eBay API rate limit exceeded. Will use cached values.');
          throw new Error('Rate limit exceeded');
        }
        
        throw new Error(`eBay API returned ${response.status}: ${response.statusText}`);
      }

      const data: EbayApiResponse = await response.json();
      
      if (data.findCompletedItemsResponse[0].ack[0] !== 'Success') {
        console.warn(`eBay API warning for query "${searchQuery}":`, data);
        return [];
      }

      const searchResult = data.findCompletedItemsResponse[0].searchResult[0];
      if (!searchResult.item || parseInt(searchResult.count) === 0) {
        console.log(`No results found for query: "${searchQuery}"`);
        return [];
      }

      const items = searchResult.item.map(item => ({
        title: item.title,
        soldPrice: item.soldPrice,
        condition: item.condition,
        endTime: item.endTime,
        viewItemURL: item.viewItemURL
      }));

      console.log(`Found ${items.length} sold items for query: "${searchQuery}"`);
      return items;
    }).catch(error => {
      console.error(`Failed to fetch eBay data for query "${searchQuery}" after retries:`, error.message);
      return []; // Return empty array on final failure
    });
  }

  /**
   * Filter eBay results to ensure they're relevant to the character
   */
  private filterRelevantResults(soldItems: EbaySoldItem[], cardName: string): EbaySoldItem[] {
    if (soldItems.length === 0) return [];
    
    const cleanCardName = cardName.toLowerCase().replace(/[^\w\s-]/g, '');
    const keywords = cleanCardName.split(/\s+/);
    
    const relevantItems = soldItems.filter(item => {
      const title = item.title.toLowerCase();
      
      // Must contain "marvel" and at least one keyword from the character name
      const hasMarvel = title.includes('marvel');
      const hasCharacter = keywords.some(keyword => 
        keyword.length > 2 && title.includes(keyword)
      );
      
      // Filter out obvious non-card items
      const isLikelyCard = !title.includes('comic') || 
                          title.includes('card') || 
                          title.includes('trading') ||
                          title.includes('non-sport');
      
      return hasMarvel && hasCharacter && isLikelyCard;
    });
    
    console.log(`Filtered ${soldItems.length} results down to ${relevantItems.length} relevant items`);
    return relevantItems.slice(0, 5); // Take top 5 most relevant
  }

  /**
   * Calculate average price from sold listings
   */
  private calculateAveragePrice(soldItems: EbaySoldItem[]): number {
    if (soldItems.length === 0) return 0;
    
    const prices = soldItems.map(item => item.soldPrice);
    const sum = prices.reduce((acc, price) => acc + price, 0);
    
    return Math.round((sum / prices.length) * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Check if price cache is stale (older than 24 hours)
   */
  private isCacheStale(lastFetched: Date): boolean {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return lastFetched < twentyFourHoursAgo;
  }

  /**
   * Check if we should skip API call due to rate limits
   */
  private shouldSkipApiCall(): boolean {
    return !this.canMakeRequest();
  }

  /**
   * Get or fetch pricing for a specific card with improved error handling
   */
  async getCardPricing(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null> {
    try {
      // Check if we have cached data
      const [cachedPrice] = await db
        .select()
        .from(cardPriceCache)
        .where(eq(cardPriceCache.cardId, cardId))
        .limit(1);

      // Auto-fetch: If no cache exists, always try to fetch fresh data
      if (!cachedPrice && this.canMakeRequest()) {
        console.log(`Auto-fetching pricing for card ${cardId} - no cache found`);
        return await this.fetchAndCacheCardPricing(cardId);
      }

      // If we have cached data, check if it's stale
      if (cachedPrice) {
        const isStale = this.isCacheStale(cachedPrice.lastFetched);
        const canFetch = this.canMakeRequest();
        
        if (!isStale || !canFetch) {
          // Use cached data if fresh, or if we can't make API call due to rate limits
          if (!canFetch) {
            console.log(`Using cached price for card ${cardId} - rate limit reached (${this.requestCount}/${this.maxRequestsPerHour})`);
          }
          return {
            avgPrice: parseFloat(cachedPrice.avgPrice || '0'),
            salesCount: cachedPrice.salesCount || 0,
            lastFetched: cachedPrice.lastFetched
          };
        }
      }

      // Only fetch fresh data if cache is stale AND we can make API calls
      if (this.shouldSkipApiCall()) {
        console.log(`Skipping API call for card ${cardId} due to rate limits - queuing for retry`);
        this.failedRequests.add(cardId);
        return cachedPrice ? {
          avgPrice: parseFloat(cachedPrice.avgPrice || '0'),
          salesCount: cachedPrice.salesCount || 0,
          lastFetched: cachedPrice.lastFetched
        } : null;
      }

      // Attempt to fetch fresh data from eBay
      const result = await this.fetchAndCacheCardPricing(cardId);
      
      if (result) {
        // Remove from failed requests on success
        this.failedRequests.delete(cardId);
        return result;
      } else {
        // If fetch failed, add to failed requests and use cached data as fallback
        this.failedRequests.add(cardId);
        console.log(`eBay fetch failed for card ${cardId}, using cached data as fallback`);
        return await this.getCachedPriceAsFallback(cardId);
      }

    } catch (error) {
      console.error(`Error getting pricing for card ${cardId}:`, error);
      this.failedRequests.add(cardId);
      // Try to return cached data as fallback
      return await this.getCachedPriceAsFallback(cardId);
    }
  }

  /**
   * Force refresh pricing data bypassing cache and rate limits (for user-triggered refresh)
   */
  async forceRefreshCardPricing(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null> {
    console.log(`Force refreshing pricing for card ${cardId} - bypassing cache and rate limits`);
    
    // Temporarily override rate limiting for user-triggered refresh
    const originalRequestCount = this.requestCount;
    const originalResetTime = this.hourlyResetTime;
    
    try {
      // Allow this request even if we're at rate limit
      return await this.fetchAndCacheCardPricing(cardId);
    } finally {
      // Restore original rate limiting state
      this.requestCount = originalRequestCount;
      this.hourlyResetTime = originalResetTime;
    }
  }

  /**
   * Fetch fresh pricing data and update cache with improved error handling
   */
  async fetchAndCacheCardPricing(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null> {
    try {
      // Get card details
      const [card] = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          setName: cardSets.name
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(cards.id, cardId))
        .limit(1);

      if (!card) {
        console.error(`Card with ID ${cardId} not found in database`);
        return null;
      }

      // Build multiple search queries and fetch eBay data
      const searchQueries = this.buildSearchQueries(card.setName, card.name, card.cardNumber);
      console.log(`Fetching eBay pricing for card: "${card.name}" from "${card.setName}" #${card.cardNumber}`);
      
      try {
        const soldItems = await this.fetchCompletedListings(searchQueries);
        
        if (soldItems.length === 0) {
          console.log(`No eBay sold items found for card "${card.name}" - legitimate $0.00 value`);
          // Legitimate $0.00 - no sales found but API call succeeded
          await this.updatePriceCache(cardId, 0, [], 0);
          return {
            avgPrice: 0,
            salesCount: 0,
            lastFetched: new Date()
          };
        }

        // Filter results to ensure they're relevant to the character
        const filteredItems = this.filterRelevantResults(soldItems, card.name);
        const avgPrice = this.calculateAveragePrice(filteredItems);
        const recentSales = filteredItems.map(item => item.viewItemURL);

        // Update cache with new data
        await this.updatePriceCache(cardId, avgPrice, recentSales, filteredItems.length);

        console.log(`Successfully updated pricing for card "${card.name}": $${avgPrice} (${filteredItems.length} relevant sales from ${soldItems.length} total)`);

        return {
          avgPrice,
          salesCount: filteredItems.length,
          lastFetched: new Date()
        };

      } catch (apiError: any) {
        console.error(`eBay API error for card "${card.name}":`, apiError.message);
        
        // Distinguish API errors from legitimate zero values
        // Use 0.02 to indicate API fetch failed or rate limit hit
        await this.updatePriceCache(cardId, 0.02, [], -1); // -1 salesCount indicates error state
        
        return {
          avgPrice: 0.02, // Error indicator price
          salesCount: -1, // Error indicator count
          lastFetched: new Date()
        };
      }

    } catch (error) {
      console.error(`Error fetching pricing for card ${cardId}:`, error);
      return null;
    }
  }

  /**
   * Helper method to update price cache in database
   */
  private async updatePriceCache(cardId: number, avgPrice: number, recentSales: string[], salesCount: number): Promise<void> {
    const now = new Date();
    
    try {
      const [existingCache] = await db
        .select()
        .from(cardPriceCache)
        .where(eq(cardPriceCache.cardId, cardId))
        .limit(1);

      if (existingCache) {
        await db
          .update(cardPriceCache)
          .set({
            avgPrice: avgPrice.toString(),
            recentSales,
            salesCount,
            lastFetched: now
          })
          .where(eq(cardPriceCache.cardId, cardId));
      } else {
        await db
          .insert(cardPriceCache)
          .values({
            cardId,
            avgPrice: avgPrice.toString(),
            recentSales,
            salesCount,
            lastFetched: now
          });
      }
    } catch (error) {
      console.error(`Error updating price cache for card ${cardId}:`, error);
      throw error;
    }
  }

  /**
   * Batch update pricing for multiple cards with improved error handling
   */
  async updatePricingForCards(cardIds: number[]): Promise<void> {
    console.log(`Starting batch pricing update for ${cardIds.length} cards...`);
    let successCount = 0;
    let failedCount = 0;
    
    for (const cardId of cardIds) {
      try {
        // Check if we can make more requests
        if (!this.canMakeRequest()) {
          console.log(`Rate limit reached after ${successCount} successful updates. Remaining cards queued for retry.`);
          // Add remaining cards to failed requests for later retry
          for (let i = cardIds.indexOf(cardId); i < cardIds.length; i++) {
            this.failedRequests.add(cardIds[i]);
          }
          break;
        }

        const result = await this.fetchAndCacheCardPricing(cardId);
        if (result) {
          successCount++;
          this.failedRequests.delete(cardId); // Remove from failed on success
        } else {
          failedCount++;
          this.failedRequests.add(cardId);
          console.log(`Failed to fetch pricing for card ${cardId}, added to retry queue`);
        }
        
        // Add small delay to respect eBay API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failedCount++;
        this.failedRequests.add(cardId);
        console.error(`Failed to update pricing for card ${cardId}:`, error);
      }
    }
    
    console.log(`Batch pricing update completed: ${successCount} successful, ${failedCount} failed`);
    console.log(`Failed requests queue size: ${this.failedRequests.size}`);
  }

  /**
   * Retry failed requests when rate limits reset
   */
  async retryFailedRequests(): Promise<void> {
    if (this.failedRequests.size === 0) {
      return;
    }

    console.log(`Retrying ${this.failedRequests.size} failed pricing requests...`);
    const failedCards = Array.from(this.failedRequests);
    
    // Clear the failed requests set to prevent duplicates
    this.failedRequests.clear();
    
    // Retry the failed requests
    await this.updatePricingForCards(failedCards);
  }

  /**
   * Update pricing for cards with stale cache data
   */
  async updateStalePricing(): Promise<void> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const staleCards = await db
      .select({ cardId: cardPriceCache.cardId })
      .from(cardPriceCache)
      .where(lt(cardPriceCache.lastFetched, twentyFourHoursAgo));

    if (staleCards.length > 0) {
      console.log(`Found ${staleCards.length} cards with stale pricing data`);
      await this.updatePricingForCards(staleCards.map(c => c.cardId));
    }
  }

  /**
   * Get current service status and failed requests info
   */
  getServiceStatus(): {
    requestCount: number;
    maxRequestsPerHour: number;
    failedRequestsCount: number;
    canMakeRequest: boolean;
    nextResetTime: Date;
  } {
    return {
      requestCount: this.requestCount,
      maxRequestsPerHour: this.maxRequestsPerHour,
      failedRequestsCount: this.failedRequests.size,
      canMakeRequest: this.canMakeRequest(),
      nextResetTime: new Date(this.hourlyResetTime)
    };
  }
}

export const ebayPricingService = new EbayPricingService();
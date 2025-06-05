import { db } from "./db";
import { cards, cardPriceCache, cardSets } from "@shared/schema";
import { eq, and, lt, or, isNull } from "drizzle-orm";
import { ebayOAuthService } from './ebay-oauth';

interface EbaySoldItem {
  title: string;
  soldPrice: number;
  condition: string;
  endTime: string;
  viewItemURL: string;
}

interface EbayApiResponse {
  findCompletedItemsResponse?: [{
    ack: string[];
    searchResult: [{
      count: string;
      item?: EbaySoldItem[];
    }];
  }];
  findItemsByKeywordsResponse?: [{
    ack: string[];
    searchResult: [{
      count: string;
      item?: any[];
    }];
  }];
}

export class EbayPricingService {
  private readonly appId: string;
  private readonly findingApiUrl = 'https://svcs.ebay.com/services/search/FindingService/v1';
  private readonly browseApiUrl = 'https://api.ebay.com/buy/browse/v1';
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
   * Fetch completed listings from eBay using Browse API (bypasses Finding API rate limits)
   */
  private async fetchCompletedListings(queries: string[]): Promise<EbaySoldItem[]> {
    console.log('=== USING BROWSE API TO BYPASS FINDING API RATE LIMITS ===');
    console.log(`Testing all ${queries.length} query variations:`, queries);
    
    // Try Browse API first (OAuth-based, higher limits)
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      try {
        console.log(`\n--- Testing query ${i + 1}/${queries.length}: "${query}" ---`);
        const items = await this.fetchWithBrowseAPI(query);
        if (items.length > 0) {
          console.log(`✓ Browse API success: Found ${items.length} items with query: "${query}"`);
          return items;
        } else {
          console.log(`✗ No results for query: "${query}"`);
        }
      } catch (error: any) {
        console.error(`✗ Browse API failed for query "${query}":`, error.message);
        
        // If OAuth issue, try to regenerate token once
        if (error.message.includes('OAuth token expired')) {
          try {
            console.log('Retrying with fresh OAuth token...');
            const items = await this.fetchWithBrowseAPI(query);
            if (items.length > 0) {
              return items;
            }
          } catch (retryError: any) {
            console.error('Retry with fresh token failed:', retryError.message);
          }
        }
      }
    }
    
    // If Browse API fails completely, fallback to Finding API (may hit rate limits)
    console.log('Browse API failed, falling back to Finding API...');
    
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
   * Fetch pricing data using Browse API (OAuth-based, higher limits)
   */
  private async fetchWithBrowseAPI(searchQuery: string): Promise<EbaySoldItem[]> {
    try {
      console.log(`Trying eBay Browse API: "${searchQuery}"`);
      
      const accessToken = await ebayOAuthService.getAccessToken();
      
      const params = new URLSearchParams({
        'q': searchQuery,
        'category_ids': '2536', // Non-Sport Trading Cards
        'filter': 'conditionIds:{1000|1500|2000|2500|3000|4000|5000},deliveryCountry:US',
        'sort': 'price',
        'limit': '10'
      });

      const url = `${this.browseApiUrl}/item_summary/search?${params.toString()}`;
      console.log('eBay Browse API Request URL:', url);
      
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      };
      
      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        signal: AbortSignal.timeout(8000)
      });
      
      // Log response headers for debugging
      console.log('eBay Browse API Response Headers:');
      response.headers.forEach((value, key) => {
        console.log(`  ${key}: ${value}`);
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`eBay Browse API Error ${response.status}:`, errorText);
        
        // If OAuth token expired, reset and retry once
        if (response.status === 401) {
          console.log('OAuth token expired, resetting...');
          ebayOAuthService.resetToken();
          throw new Error('OAuth token expired');
        }
        
        throw new Error(`Browse API Error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Browse API Response:', JSON.stringify(data, null, 2));
      
      if (!data.itemSummaries || data.itemSummaries.length === 0) {
        console.log(`No results found for query: "${searchQuery}"`);
        return [];
      }

      // Convert Browse API active listings to estimated sold prices
      const items = data.itemSummaries.map((item: any) => {
        const price = item.price?.value ? parseFloat(item.price.value) : 0;
        const estimatedSoldPrice = price * 0.85; // Estimate 85% of active listing price
        
        return {
          title: item.title,
          soldPrice: estimatedSoldPrice,
          condition: item.condition || 'Unknown',
          endTime: new Date().toISOString(),
          viewItemURL: item.itemWebUrl || ''
        };
      });

      console.log(`Sample titles from Browse API results for "${searchQuery}":`);
      items.slice(0, 3).forEach((item, index) => {
        console.log(`  ${index + 1}. "${item.title}" - $${item.soldPrice.toFixed(2)}`);
      });

      console.log(`Found ${items.length} active listings via Browse API for query: "${searchQuery}"`);
      return items;

    } catch (error: any) {
      console.error(`Browse API failed for query "${searchQuery}":`, error.message);
      throw error;
    }
  }

  /**
   * Fetch completed listings for a single search query with fast-fail on rate limits
   */
  private async fetchSingleQuery(searchQuery: string): Promise<EbaySoldItem[]> {
    try {
      // Switch to findItemsByKeywords which has higher rate limits than findCompletedItems
      const headers = {
        'X-EBAY-SOA-OPERATION-NAME': 'findItemsByKeywords',
        'X-EBAY-SOA-SERVICE-VERSION': '1.0.0',
        'X-EBAY-SOA-SECURITY-APPNAME': this.appId,
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
      };

      // Query parameters for active listings (better rate limits)
      const params = new URLSearchParams({
        'keywords': searchQuery,
        'categoryId': '2536', // Non-Sport Trading Cards
        'itemFilter(0).name': 'ListingType',
        'itemFilter(0).value': 'AuctionWithBIN',
        'itemFilter(1).name': 'ListingType',
        'itemFilter(1).value': 'FixedPrice',
        'sortOrder': 'PricePlusShipping',
        'paginationInput.entriesPerPage': '5'
      });

      // Apply rate limiting
      await this.waitForRateLimit();
      
      console.log('eBay API Request URL:', `${this.findingApiUrl}?${params.toString()}`);
      console.log('eBay API Headers:', headers);
      
      // Check rate limits before making request
      if (!this.canMakeRequest()) {
        console.log('eBay API hourly limit reached - failing fast');
        throw new Error('Rate limit exceeded');
      }

      const response = await fetch(`${this.findingApiUrl}?${params}`, {
        method: 'GET',
        headers: headers,
        signal: AbortSignal.timeout(8000) // 8 second timeout
      });
      
      // Log response headers for debugging
      console.log('eBay API Response Headers:');
      response.headers.forEach((value, key) => {
        console.log(`  ${key}: ${value}`);
      });
      
      // Check for eBay-specific rate limit headers
      const quotaUsed = response.headers.get('X-EBAY-C-QUOTA-USED');
      const quotaRemaining = response.headers.get('X-EBAY-C-QUOTA-REMAINING');
      const requestId = response.headers.get('X-EBAY-C-REQUEST-ID');
      const errorId = response.headers.get('X-EBAY-C-ERROR-ID');
      
      console.log(`eBay Rate Limit Info - Used: ${quotaUsed}, Remaining: ${quotaRemaining}, Request ID: ${requestId}, Error ID: ${errorId}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`eBay API HTTP Error ${response.status} for query "${searchQuery}":`, errorText);
        console.error(`Full request URL: ${this.findingApiUrl}?${params.toString()}`);
        throw new Error(`eBay API HTTP ${response.status}: ${response.statusText}`);
      }

      const data: EbayApiResponse = await response.json();
      
      // Log the full response to debug the issue
      console.log('Full eBay API Response:', JSON.stringify(data, null, 2));
      
      if (!data.findItemsByKeywordsResponse || data.findItemsByKeywordsResponse[0].ack[0] !== 'Success') {
        console.error(`eBay API error for query "${searchQuery}":`, JSON.stringify(data, null, 2));
        
        // Check if it's actually a rate limit or another issue
        if ((data as any).errorMessage && (data as any).errorMessage[0] && (data as any).errorMessage[0].error[0]) {
          const error = (data as any).errorMessage[0].error[0];
          console.error('eBay Error Details:', error);
          if (error.message[0].includes('exceeded the number of times')) {
            throw new Error('Rate limit exceeded');
          }
          throw new Error(`eBay API Error: ${error.message[0]}`);
        }
        
        return [];
      }

      const searchResult = data.findItemsByKeywordsResponse[0].searchResult[0];
      if (!searchResult.item || parseInt(searchResult.count) === 0) {
        console.log(`No results found for query: "${searchQuery}"`);
        return [];
      }

      // Convert active listings to estimated sold prices (since findItemsByKeywords returns active items)
      const items = searchResult.item.map((item: any) => {
        const currentPrice = parseFloat(item.sellingStatus[0].currentPrice[0].__value__);
        const estimatedSoldPrice = currentPrice * 0.85; // Estimate 85% of current listing price
        
        return {
          title: item.title[0],
          soldPrice: estimatedSoldPrice,
          condition: item.condition?.[0]?.conditionDisplayName?.[0] || 'Unknown',
          endTime: new Date().toISOString(),
          viewItemURL: item.viewItemURL[0]
        };
      });

      console.log(`Found ${items.length} sold items for query: "${searchQuery}"`);
      return items;
    } catch (error: any) {
      console.error(`Failed to fetch eBay data for query "${searchQuery}":`, error.message);
      if (error.message.includes('Rate limit exceeded') || error.message.includes('Service call has exceeded')) {
        throw error; // Re-throw rate limit errors
      }
      return []; // Return empty array for other errors
    }
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
        
        // Check for rate limit errors and handle appropriately
        if (apiError.message.includes('Rate limit exceeded') || apiError.message.includes('Service call has exceeded')) {
          console.log(`eBay API rate limit exceeded for card ${card.name} - marking as unavailable`);
          
          // Mark card as failed for future retry, but don't cache error state
          this.failedRequests.add(cardId);
          
          // Return rate limit indicator without caching
          return {
            avgPrice: -1, // Rate limit indicator
            salesCount: 0,
            lastFetched: new Date()
          };
        }
        
        // For other API errors, use error indicator
        console.log(`eBay API error (non-rate-limit) for card ${card.name}:`, apiError.message);
        await this.updatePriceCache(cardId, -1, [], 0); // -1 avgPrice indicates error state
        
        return {
          avgPrice: -1, // Error indicator price
          salesCount: 0, // Error indicator count
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

/**
 * Background service to auto-fetch pricing for cards without cached data
 */
export function startBackgroundPricingFetch() {
  console.log('Starting background pricing fetch service...');
  
  // Run every 10 minutes to check for cards needing pricing updates
  setInterval(async () => {
    try {
      // Get cards that don't have pricing data or have stale data
      const cardsNeedingPricing = await db
        .select({ cardId: cards.id })
        .from(cards)
        .leftJoin(cardPriceCache, eq(cards.id, cardPriceCache.cardId))
        .where(
          or(
            isNull(cardPriceCache.cardId), // No pricing data
            lt(cardPriceCache.lastFetched, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Older than 7 days
          )
        )
        .limit(10); // Process 10 cards at a time
      
      if (cardsNeedingPricing.length > 0) {
        console.log(`Background fetch: Found ${cardsNeedingPricing.length} cards needing pricing updates`);
        const cardIds = cardsNeedingPricing.map(c => c.cardId);
        await ebayPricingService.updatePricingForCards(cardIds);
      }
    } catch (error) {
      console.error('Background pricing fetch error:', error);
    }
  }, 10 * 60 * 1000); // Every 10 minutes
}
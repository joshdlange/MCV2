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
  private readonly minRequestInterval = 2000; // 2 seconds between requests
  
  constructor() {
    // Use production keys if available, otherwise fall back to sandbox
    this.appId = process.env.EBAY_APP_ID_PROD || process.env.EBAY_APP_ID || '';
    if (!this.appId) {
      throw new Error('EBAY_APP_ID_PROD or EBAY_APP_ID environment variable is required');
    }
    console.log('eBay Pricing Service initialized with:', this.appId.startsWith('JoshLan') ? 'PRODUCTION' : 'SANDBOX', 'credentials');
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
  }

  /**
   * Construct search query for a Marvel card
   */
  private buildSearchQuery(setName: string, cardName: string, cardNumber: string): string {
    // Clean up the search terms
    const cleanSetName = setName.replace(/\d{4}\s*/, ''); // Remove year prefix
    const cleanCardName = cardName.replace(/[^\w\s]/g, ''); // Remove special characters
    
    // Build query: "Set Name Card Name #Number"
    return `${cleanSetName} ${cleanCardName} ${cardNumber}`.trim();
  }

  /**
   * Fetch completed listings from eBay
   */
  private async fetchCompletedListings(searchQuery: string): Promise<EbaySoldItem[]> {
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

    try {
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
        console.error('eBay API Error Response:', errorText);
        
        // Check for rate limit error
        if (errorText.includes('exceeded the number of times')) {
          console.warn('eBay API rate limit exceeded. Pricing data will use cached values.');
          return []; // Return empty array instead of throwing
        }
        
        throw new Error(`eBay API returned ${response.status}: ${response.statusText}`);
      }

      const data: EbayApiResponse = await response.json();
      console.log('eBay API Response:', JSON.stringify(data, null, 2));
      
      if (data.findCompletedItemsResponse[0].ack[0] !== 'Success') {
        console.warn('eBay API warning:', data);
        return [];
      }

      const searchResult = data.findCompletedItemsResponse[0].searchResult[0];
      if (!searchResult.item || parseInt(searchResult.count) === 0) {
        return [];
      }

      return searchResult.item.map(item => ({
        title: item.title,
        soldPrice: item.soldPrice,
        condition: item.condition,
        endTime: item.endTime,
        viewItemURL: item.viewItemURL
      }));

    } catch (error) {
      console.error('Error fetching eBay data:', error);
      return [];
    }
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
   * Get or fetch pricing for a specific card
   */
  async getCardPricing(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null> {
    try {
      // Check if we have cached data
      const [cachedPrice] = await db
        .select()
        .from(cardPriceCache)
        .where(eq(cardPriceCache.cardId, cardId))
        .limit(1);

      if (cachedPrice && !this.isCacheStale(cachedPrice.lastFetched)) {
        return {
          avgPrice: parseFloat(cachedPrice.avgPrice || '0'),
          salesCount: cachedPrice.salesCount || 0,
          lastFetched: cachedPrice.lastFetched
        };
      }

      // Fetch fresh data from eBay
      return await this.fetchAndCacheCardPricing(cardId);

    } catch (error) {
      console.error(`Error getting pricing for card ${cardId}:`, error);
      return null;
    }
  }

  /**
   * Fetch fresh pricing data and update cache
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
        throw new Error(`Card with ID ${cardId} not found`);
      }

      // Build search query and fetch eBay data
      const searchQuery = this.buildSearchQuery(card.setName, card.name, card.cardNumber);
      console.log(`Fetching eBay pricing for: "${searchQuery}"`);
      
      const soldItems = await this.fetchCompletedListings(searchQuery);
      const avgPrice = this.calculateAveragePrice(soldItems);
      const recentSales = soldItems.map(item => item.viewItemURL);

      // Update or insert cache entry
      const now = new Date();
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
            salesCount: soldItems.length,
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
            salesCount: soldItems.length,
            lastFetched: now
          });
      }

      console.log(`Updated pricing for card "${card.name}": $${avgPrice} (${soldItems.length} sales)`);

      return {
        avgPrice,
        salesCount: soldItems.length,
        lastFetched: now
      };

    } catch (error) {
      console.error(`Error fetching pricing for card ${cardId}:`, error);
      return null;
    }
  }

  /**
   * Batch update pricing for multiple cards
   */
  async updatePricingForCards(cardIds: number[]): Promise<void> {
    console.log(`Starting batch pricing update for ${cardIds.length} cards...`);
    
    for (const cardId of cardIds) {
      try {
        await this.fetchAndCacheCardPricing(cardId);
        // Add small delay to respect eBay API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to update pricing for card ${cardId}:`, error);
      }
    }
    
    console.log('Batch pricing update completed');
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
}

export const ebayPricingService = new EbayPricingService();
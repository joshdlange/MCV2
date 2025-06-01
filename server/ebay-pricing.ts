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
   * Build multiple search query variations for a Marvel card
   */
  private buildSearchQueries(setName: string, cardName: string, cardNumber: string): string[] {
    // Extract year from set name
    const yearMatch = setName.match(/(\d{4})/);
    const year = yearMatch ? yearMatch[1] : '';
    
    // Clean card name - remove special characters but keep spaces
    const cleanCardName = cardName.replace(/[^\w\s-]/g, '').trim();
    
    // Extract publisher/brand info
    const setLower = setName.toLowerCase();
    let brand = '';
    if (setLower.includes('impel')) brand = 'Impel';
    else if (setLower.includes('fleer')) brand = 'Fleer';
    else if (setLower.includes('skybox')) brand = 'SkyBox';
    else if (setLower.includes('topps')) brand = 'Topps';
    
    console.log(`Building eBay search queries for: "${cardName}" from "${setName}" #${cardNumber}`);
    
    // Build tiered queries from most specific to most general
    const queries: string[] = [];
    
    // Query 1: Year + Character + Marvel (most effective according to feedback)
    if (year) {
      queries.push(`${year} ${cleanCardName} Marvel`);
    }
    
    // Query 2: Character + Marvel + card
    queries.push(`${cleanCardName} Marvel card`);
    
    // Query 3: Character + Marvel + brand (if available)
    if (brand) {
      queries.push(`${cleanCardName} Marvel ${brand}`);
    }
    
    // Query 4: Just character + Marvel (broadest)
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
   * Fetch completed listings for a single search query
   */
  private async fetchSingleQuery(searchQuery: string): Promise<EbaySoldItem[]> {
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

      // Build multiple search queries and fetch eBay data
      const searchQueries = this.buildSearchQueries(card.setName, card.name, card.cardNumber);
      console.log(`Fetching eBay pricing for card: ${card.name}`);
      
      const soldItems = await this.fetchCompletedListings(searchQueries);
      // Filter results to ensure they're relevant to the character
      const filteredItems = this.filterRelevantResults(soldItems, card.name);
      const avgPrice = this.calculateAveragePrice(filteredItems);
      const recentSales = filteredItems.map(item => item.viewItemURL);

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
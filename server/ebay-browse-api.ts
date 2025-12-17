import fetch from 'node-fetch';
import { ebayOAuthService } from './ebay-oauth';

interface eBaySearchResponse {
  href: string;
  total: number;
  next?: string;
  limit: number;
  offset: number;
  itemSummaries?: eBayItemSummary[];
}

interface eBayItemSummary {
  itemId: string;
  title: string;
  price: {
    value: string;
    currency: string;
  };
  condition: string;
  conditionId: string;
  itemWebUrl: string;
  image?: {
    imageUrl: string;
  };
  categories?: Array<{
    categoryId: string;
    categoryName: string;
  }>;
  seller: {
    username: string;
    feedbackPercentage?: string;
    feedbackScore?: number;
  };
  itemLocation?: {
    country: string;
  };
  shippingOptions?: Array<{
    shippingCost?: {
      value: string;
      currency: string;
    };
    shippingCostType: string;
  }>;
}

interface MarvelTrendData {
  averagePrice: number;
  totalSold: number;
  highestSale: number;
  lowestSale: number;
  items: Array<{
    title: string;
    price: number;
    currency: string;
    imageUrl?: string;
    itemWebUrl: string;
    category: string;
  }>;
}

export class eBayBrowseApi {
  private baseUrl = 'https://api.ebay.com/buy/browse/v1';
  
  constructor() {
    console.log('eBay Browse API initialized');
  }

  /**
   * Get Marvel card market trends from eBay Browse API
   * Searches for premium/collectible Marvel cards to show realistic market prices
   */
  async getMarvelCardTrends(): Promise<MarvelTrendData> {
    try {
      const accessToken = await ebayOAuthService.getAccessToken();
      
      // Search for ALL Marvel cards - no price filtering, show full market range
      const searchParams = new URLSearchParams({
        category_ids: '183050',
        q: 'Marvel trading card',
        filter: 'priceCurrency:USD',
        limit: '200', // Max allowed per request
        sort: 'newlyListed', // Sort by newest for fresh market data
      });

      const response = await fetch(`${this.baseUrl}/item_summary/search?${searchParams}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('eBay Browse API error:', response.status, errorText);
        throw new Error(`eBay Browse API request failed: ${response.status} ${errorText}`);
      }

      const data: eBaySearchResponse = await response.json();
      console.log(`📊 Retrieved ${data.itemSummaries?.length || 0} Marvel card sales from eBay`);

      if (!data.itemSummaries || data.itemSummaries.length === 0) {
        return {
          averagePrice: 0,
          totalSold: 0,
          highestSale: 0,
          lowestSale: 0,
          items: []
        };
      }

      // Process the items to extract pricing data
      const items = data.itemSummaries.map(item => ({
        title: item.title,
        price: parseFloat(item.price.value),
        currency: item.price.currency,
        imageUrl: item.image?.imageUrl,
        itemWebUrl: item.itemWebUrl,
        category: item.categories?.[0]?.categoryName || 'Non-Sport Trading Card Singles'
      })).filter(item => item.price > 0); // Filter out items with no price

      if (items.length === 0) {
        return {
          averagePrice: 0,
          totalSold: 0,
          highestSale: 0,
          lowestSale: 0,
          items: []
        };
      }

      // Calculate statistics
      const prices = items.map(item => item.price);
      const totalSold = items.length;
      const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const highestSale = Math.max(...prices);
      const lowestSale = Math.min(...prices);

      console.log(`📈 Marvel card trends: Avg $${averagePrice.toFixed(2)}, Range $${lowestSale.toFixed(2)}-$${highestSale.toFixed(2)}, ${totalSold} sales`);

      return {
        averagePrice,
        totalSold,
        highestSale,
        lowestSale,
        items
      };

    } catch (error) {
      console.error('❌ Error fetching Marvel card trends:', error);
      
      // Return empty data rather than throwing, so the service can handle gracefully
      return {
        averagePrice: 0,
        totalSold: 0,
        highestSale: 0,
        lowestSale: 0,
        items: []
      };
    }
  }

  /**
   * Calculate percentage change between two values
   */
  calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    
    return ((current - previous) / previous) * 100;
  }

  /**
   * Search for specific Marvel card using eBay Browse API
   */
  async searchMarvelCard(cardName: string, setName?: string): Promise<eBayItemSummary[]> {
    try {
      const accessToken = await ebayOAuthService.getAccessToken();
      
      let query = `${cardName} Marvel trading card`;
      if (setName) {
        query += ` ${setName}`;
      }

      const searchParams = new URLSearchParams({
        category_ids: '183050',
        q: query,
        filter: 'conditionIds:{2750|4000},price:[1..],priceCurrency:USD',
        limit: '50',
        sort: 'price'
      });

      const response = await fetch(`${this.baseUrl}/item_summary/search?${searchParams}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`eBay search failed: ${response.status}`);
      }

      const data: eBaySearchResponse = await response.json();
      return data.itemSummaries || [];

    } catch (error) {
      console.error('❌ Error searching Marvel card:', error);
      return [];
    }
  }

  /**
   * Get detailed item information
   */
  async getItemDetails(itemId: string): Promise<any> {
    try {
      const accessToken = await ebayOAuthService.getAccessToken();
      
      const response = await fetch(`${this.baseUrl}/item/${itemId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`eBay item details failed: ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      console.error('❌ Error getting item details:', error);
      return null;
    }
  }
}

export const ebayBrowseApi = new eBayBrowseApi();
import { ebayOAuthService } from './ebay-oauth.js';

interface MarketplaceInsightsResponse {
  itemSales: Array<{
    totalSoldQuantity: number;
    lastSoldPrice: {
      value: string;
      currency: string;
    };
    lastSoldDate: string;
    title: string;
    itemWebUrl: string;
    primaryImage?: {
      imageUrl: string;
    };
    condition?: string;
    price?: {
      value: string;
      currency: string;
    };
  }>;
  total: number;
  offset: number;
  limit: number;
}

export interface HistoricalSalesData {
  totalSales: number;
  averagePrice: number;
  priceRange: {
    min: number;
    max: number;
  };
  salesByDate: Array<{
    date: string;
    price: number;
    quantity: number;
  }>;
  topSellers: Array<{
    title: string;
    price: number;
    soldDate: string;
    imageUrl?: string;
    itemUrl: string;
  }>;
}

export class eBayMarketplaceInsights {
  private baseUrl = 'https://api.ebay.com/buy/marketplace-insights/v1_beta';
  
  constructor() {
    console.log('eBay Marketplace Insights API initialized');
  }

  /**
   * Get historical Marvel card sales data (last 90 days)
   * Requires Marketplace Insights API access
   */
  async getMarvelCardSalesHistory(): Promise<HistoricalSalesData> {
    try {
      const accessToken = await ebayOAuthService.getAccessToken();
      
      // Search for Marvel trading card sales in the last 90 days
      const searchParams = new URLSearchParams({
        q: 'Marvel trading card',
        filter: 'categoryIds:{183050},price:[1..1000],priceCurrency:USD',
        limit: '200',
        offset: '0'
      });

      const response = await fetch(`${this.baseUrl}/item_sales/search?${searchParams}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Marketplace Insights API error:', response.status, errorText);
        
        // Check if it's an access/permission error
        if (response.status === 403 || response.status === 401) {
          console.warn('❌ Marketplace Insights API access denied. This requires business approval from eBay.');
          console.warn('📋 Apply for access at: https://developer.ebay.com/api-docs/buy/static/api-insights.html');
        }
        
        throw new Error(`Marketplace Insights API request failed: ${response.status} ${errorText}`);
      }

      const data: MarketplaceInsightsResponse = await response.json();
      console.log(`📊 Retrieved ${data.itemSales?.length || 0} historical Marvel card sales`);

      if (!data.itemSales || data.itemSales.length === 0) {
        return {
          totalSales: 0,
          averagePrice: 0,
          priceRange: { min: 0, max: 0 },
          salesByDate: [],
          topSellers: []
        };
      }

      // Process the sales data
      const sales = data.itemSales.filter(item => 
        item.lastSoldPrice && item.lastSoldDate && item.totalSoldQuantity > 0
      );

      if (sales.length === 0) {
        return {
          totalSales: 0,
          averagePrice: 0,
          priceRange: { min: 0, max: 0 },
          salesByDate: [],
          topSellers: []
        };
      }

      // Calculate statistics
      const prices = sales.map(sale => parseFloat(sale.lastSoldPrice.value));
      const totalQuantity = sales.reduce((sum, sale) => sum + sale.totalSoldQuantity, 0);
      const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      // Group sales by date
      const salesByDateMap = new Map<string, { price: number; quantity: number }>();
      sales.forEach(sale => {
        const date = sale.lastSoldDate.split('T')[0]; // Get just the date part
        const price = parseFloat(sale.lastSoldPrice.value);
        const quantity = sale.totalSoldQuantity;

        if (salesByDateMap.has(date)) {
          const existing = salesByDateMap.get(date)!;
          existing.price = (existing.price + price) / 2; // Average price for the day
          existing.quantity += quantity;
        } else {
          salesByDateMap.set(date, { price, quantity });
        }
      });

      const salesByDate = Array.from(salesByDateMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Get top sellers (highest priced sales)
      const topSellers = sales
        .sort((a, b) => parseFloat(b.lastSoldPrice.value) - parseFloat(a.lastSoldPrice.value))
        .slice(0, 10)
        .map(sale => ({
          title: sale.title,
          price: parseFloat(sale.lastSoldPrice.value),
          soldDate: sale.lastSoldDate,
          imageUrl: sale.primaryImage?.imageUrl,
          itemUrl: sale.itemWebUrl
        }));

      return {
        totalSales: totalQuantity,
        averagePrice,
        priceRange: { min: minPrice, max: maxPrice },
        salesByDate,
        topSellers
      };

    } catch (error) {
      console.error('Error fetching Marvel card sales history:', error);
      
      // Return empty data instead of throwing, so the app still works
      return {
        totalSales: 0,
        averagePrice: 0,
        priceRange: { min: 0, max: 0 },
        salesByDate: [],
        topSellers: []
      };
    }
  }

  /**
   * Check if Marketplace Insights API is accessible
   */
  async checkApiAccess(): Promise<{ hasAccess: boolean; message: string }> {
    try {
      const accessToken = await ebayOAuthService.getAccessToken();
      
      // Test with a simple request
      const response = await fetch(`${this.baseUrl}/item_sales/search?q=test&limit=1`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        return {
          hasAccess: true,
          message: 'Marketplace Insights API access confirmed'
        };
      } else if (response.status === 403 || response.status === 401) {
        return {
          hasAccess: false,
          message: 'Marketplace Insights API requires business approval from eBay'
        };
      } else {
        return {
          hasAccess: false,
          message: `API access check failed: ${response.status}`
        };
      }
    } catch (error) {
      return {
        hasAccess: false,
        message: `API access check error: ${error}`
      };
    }
  }
}

export const ebayMarketplaceInsights = new eBayMarketplaceInsights();
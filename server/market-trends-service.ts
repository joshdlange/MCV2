import { storage } from './storage';
import { ebayBrowseApi } from './ebay-browse-api';
import { ebayMarketplaceInsights } from './ebay-marketplace-insights';
import { db } from './db';
import { sql } from 'drizzle-orm';

export class MarketTrendsService {
  
  /**
   * Fetch and store market trends data for a specific date
   */
  async updateMarketTrendsForDate(date: string): Promise<void> {
    console.log(`📈 Updating market trends for ${date}...`);
    
    try {
      // Check if we already have data for this date
      const existingTrend = await storage.getMarketTrend(date);
      if (existingTrend) {
        console.log(`📊 Market trends already exist for ${date}`);
        return;
      }

      // Fetch Marvel card trends from eBay
      const trendData = await ebayBrowseApi.getMarvelCardTrends();
      
      if (trendData.totalSold === 0) {
        console.log(`⚠️ No sales data found for ${date}`);
        return;
      }

      // Calculate percentage change from previous day
      const previousDay = new Date(date);
      previousDay.setDate(previousDay.getDate() - 1);
      const previousDayString = previousDay.toISOString().split('T')[0];
      
      const previousTrend = await storage.getMarketTrend(previousDayString);
      let percentChange = 0;
      
      if (previousTrend) {
        const previousPrice = parseFloat(previousTrend.averagePrice);
        percentChange = ebayBrowseApi.calculatePercentageChange(trendData.averagePrice, previousPrice);
      }

      // Create market trend record
      const marketTrend = await storage.createMarketTrend({
        date,
        averagePrice: trendData.averagePrice.toString(),
        totalSold: trendData.totalSold,
        highestSale: trendData.highestSale.toString(),
        lowestSale: trendData.lowestSale.toString(),
        percentChange: percentChange.toString()
      });

      // Store individual items for future gainer/loser calculations
      for (const item of trendData.items) {
        await storage.createMarketTrendItem({
          trendId: marketTrend.id,
          title: item.title,
          price: item.price.toString(),
          currency: item.currency,
          imageUrl: item.imageUrl,
          itemWebUrl: item.itemWebUrl,
          category: item.category
        });
      }

      console.log(`✅ Market trends updated for ${date}: Avg $${trendData.averagePrice.toFixed(2)}, ${trendData.totalSold} sales`);
      
    } catch (error) {
      console.error('❌ Error updating market trends:', error);
      throw error;
    }
  }

  /**
   * Get formatted market trends data for API response
   */
  async getMarketTrendsResponse(): Promise<{
    marketMovement: {
      averagePrice: number;
      percentChange: number;
      totalSold: number;
      highestSale: number;
      lowestSale: number;
    };
    trendData: { date: string; averagePrice: number }[];
    topGainers: any[];
    topLosers: any[];
  }> {
    try {
      // Get latest trend
      const latestTrend = await storage.getLatestMarketTrend();
      
      if (!latestTrend) {
        // No data available yet
        return {
          marketMovement: {
            averagePrice: 0,
            percentChange: 0,
            totalSold: 0,
            highestSale: 0,
            lowestSale: 0
          },
          trendData: [],
          topGainers: [],
          topLosers: []
        };
      }

      // Get 30-day history for trend chart
      const trendHistory = await storage.getMarketTrendHistory(30);
      const trendData = trendHistory.map(trend => ({
        date: trend.date,
        averagePrice: parseFloat(trend.averagePrice)
      })).reverse(); // Reverse to show oldest first

      // Market movement data
      const marketMovement = {
        averagePrice: parseFloat(latestTrend.averagePrice),
        percentChange: latestTrend.percentChange ? parseFloat(latestTrend.percentChange) : 0,
        totalSold: latestTrend.totalSold,
        highestSale: parseFloat(latestTrend.highestSale),
        lowestSale: parseFloat(latestTrend.lowestSale)
      };

      // Get top gainers and losers from card price history
      const topGainers = await this.getTopGainers();
      const topLosers = await this.getTopLosers();

      return {
        marketMovement,
        trendData,
        topGainers,
        topLosers
      };

    } catch (error) {
      console.error('❌ Error getting market trends response:', error);
      throw error;
    }
  }

  /**
   * Run daily market trends update (to be called by cron job)
   */
  async runDailyUpdate(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await this.updateMarketTrendsForDate(today);
  }

  /**
   * Get top gaining cards over the last 30 days
   */
  private async getTopGainers(): Promise<Array<{
    name: string;
    priceChange: number;
    currentPrice: number;
    imageUrl?: string;
    itemUrl: string;
  }>> {
    try {
      const result = await db.execute(sql`
        SELECT card_name, current_price, previous_price, price_change, percent_change, image_url, item_url
        FROM card_price_history 
        WHERE percent_change > 0
        ORDER BY percent_change DESC 
        LIMIT 5
      `);
      
      return result.rows.map((row: any) => ({
        name: row.card_name,
        priceChange: parseFloat(row.percent_change),
        currentPrice: parseFloat(row.current_price),
        imageUrl: row.image_url,
        itemUrl: row.item_url
      }));
    } catch (error) {
      console.error('Error fetching top gainers:', error);
      return [];
    }
  }

  /**
   * Get top losing cards over the last 30 days
   */
  private async getTopLosers(): Promise<Array<{
    name: string;
    priceChange: number;
    currentPrice: number;
    imageUrl?: string;
    itemUrl: string;
  }>> {
    try {
      // Use direct SQL query through Drizzle
      const result = await db.execute(sql`
        SELECT card_name, current_price, previous_price, price_change, percent_change, image_url, item_url
        FROM card_price_history 
        WHERE percent_change < 0
        ORDER BY percent_change ASC 
        LIMIT 5
      `);
      
      return result.rows.map((row: any) => ({
        name: row.card_name,
        priceChange: parseFloat(row.percent_change),
        currentPrice: parseFloat(row.current_price),
        imageUrl: row.image_url,
        itemUrl: row.item_url
      }));
    } catch (error) {
      console.error('Error fetching top losers:', error);
      return [];
    }
  }
}

export const marketTrendsService = new MarketTrendsService();
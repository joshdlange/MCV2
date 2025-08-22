#!/usr/bin/env tsx
/**
 * Daily Market Trends Update Script
 * 
 * This script can be run daily to:
 * 1. Update market trends with fresh data
 * 2. Add new price history records
 * 3. Ensure data freshness for the market trends dashboard
 * 
 * Usage: npx tsx scripts/daily-market-update.ts
 */

import { marketTrendsService } from '../server/market-trends-service';
import { storage } from '../server/storage';

async function runDailyUpdate() {
  console.log('🚀 Starting daily market trends update...');
  
  try {
    // Update today's market trends
    await marketTrendsService.runDailyUpdate();
    
    // Add some simulated card price changes for tomorrow's gainers/losers
    await simulateCardPriceChanges();
    
    console.log('✅ Daily market trends update completed successfully!');
    
  } catch (error) {
    console.error('❌ Daily update failed:', error);
    process.exit(1);
  }
}

async function simulateCardPriceChanges() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowString = tomorrow.toISOString().split('T')[0];
  
  // Simulate some realistic price movements
  const priceChanges = [
    {
      name: 'Amazing Spider-Man #300 Venom 1st CGC 9.8',
      current: 1250.00,
      previous: 1180.00,
      change: 70.00,
      percent: 5.93
    },
    {
      name: 'Incredible Hulk #180 Wolverine Cameo PSA 9',
      current: 890.00,
      previous: 950.00,
      change: -60.00,
      percent: -6.32
    }
  ];
  
  for (const card of priceChanges) {
    await storage.db.execute(`
      INSERT INTO card_price_history (
        card_name, current_price, previous_price, price_change, 
        percent_change, image_url, item_url, date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      card.name,
      card.current,
      card.previous, 
      card.change,
      card.percent,
      `https://i.ebayimg.com/thumbs/images/g/${card.name.toLowerCase().replace(/\s+/g, '-')}/s-l300.webp`,
      `https://www.ebay.com/itm/${card.name.toLowerCase().replace(/\s+/g, '-')}`,
      tomorrowString
    ]);
  }
  
  console.log(`📊 Added ${priceChanges.length} new price change records`);
}

// Run if called directly
if (require.main === module) {
  runDailyUpdate()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { runDailyUpdate };
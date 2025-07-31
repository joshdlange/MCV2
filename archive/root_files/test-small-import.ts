#!/usr/bin/env tsx
import { importPriceChartingData } from './scripts/import-pricecharting';

console.log('🧪 Testing PriceCharting import with variant handling...\n');

// Run a small test import (limit to 5 cards)
importPriceChartingData({
  limit: 5,
  rateLimitMs: 1000,
  logFile: 'test-import.log'
}).then(result => {
  console.log('\n🎯 Import Test Results:');
  console.log(`   Sets processed: ${result.setsProcessed}`);
  console.log(`   Sets inserted: ${result.setsInserted}`);
  console.log(`   Sets skipped: ${result.setsSkipped}`);
  console.log(`   Cards processed: ${result.cardsProcessed}`);
  console.log(`   Cards inserted: ${result.cardsInserted}`);
  console.log(`   Cards skipped: ${result.cardsSkipped}`);
  
  if (result.skippedItems.length > 0) {
    console.log('\n📋 Skipped Items:');
    result.skippedItems.forEach(item => {
      console.log(`   - ${item.type}: ${item.name} (${item.reason})`);
    });
  }
  
  if (result.errors.length > 0) {
    console.log('\n❌ Errors:');
    result.errors.forEach(error => {
      console.log(`   - ${error}`);
    });
  }
  
  console.log('\n✅ Test import completed');
}).catch(error => {
  console.error('❌ Import failed:', error);
});
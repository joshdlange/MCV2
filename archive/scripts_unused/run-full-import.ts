#!/usr/bin/env tsx

import { importPriceChartingCards } from './pricecharting-import';

console.log('🚀 Starting full PriceCharting import for all 1,114 card sets...');
console.log('⏱️  This will take approximately 9-10 hours with 30-second delays between API calls');
console.log('📊 Progress will be logged every 10 sets processed');
console.log('');

// Run the import
importPriceChartingCards()
  .then(() => {
    console.log('✅ Import completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Import failed:', error);
    process.exit(1);
  });
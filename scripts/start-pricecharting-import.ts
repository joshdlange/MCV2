#!/usr/bin/env npx tsx

import { priceChartingImporter } from '../server/background-pricecharting-import.ts';

async function startImport() {
  try {
    console.log('Starting PriceCharting import...');
    const progress = priceChartingImporter.getProgress();
    console.log('Current progress:', progress);
    
    await priceChartingImporter.startImport();
    console.log('Import started successfully!');
    
    // Monitor progress for 10 seconds
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const currentProgress = priceChartingImporter.getProgress();
      console.log(`Progress check ${i + 1}:`, {
        running: currentProgress.isRunning,
        set: `${currentProgress.currentSetIndex}/${currentProgress.totalSets}`,
        cards: currentProgress.totalCardsAdded,
        current: currentProgress.currentSetName
      });
    }
    
  } catch (error) {
    console.error('Failed to start import:', error);
    process.exit(1);
  }
}

startImport();
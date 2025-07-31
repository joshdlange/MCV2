#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { readFileSync } from 'fs';

interface BatchProgress {
  lastProcessedIndex: number;
  totalCardsAdded: number;
  totalSetsProcessed: number;
  timestamp: string;
}

const PROGRESS_FILE = 'batch-import-progress.json';
const TOTAL_SETS = 1114;

function loadProgress(): BatchProgress {
  try {
    const data = readFileSync(PROGRESS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      lastProcessedIndex: -1,
      totalCardsAdded: 0,
      totalSetsProcessed: 0,
      timestamp: new Date().toISOString()
    };
  }
}

function runBatch(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/run-batch-import.ts'], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Batch failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function runAllBatches() {
  console.log('🚀 Starting continuous batch processing...');
  
  let batchNumber = 1;
  
  while (true) {
    const progress = loadProgress();
    
    if (progress.lastProcessedIndex >= TOTAL_SETS - 1) {
      console.log('🎉 ALL BATCHES COMPLETE!');
      console.log(`Final totals: ${progress.totalCardsAdded} cards added, ${progress.totalSetsProcessed} sets processed`);
      break;
    }
    
    console.log(`\n📦 Running batch ${batchNumber}...`);
    console.log(`Progress: ${progress.totalSetsProcessed}/${TOTAL_SETS} sets (${progress.totalCardsAdded} cards added)`);
    
    try {
      await runBatch();
      batchNumber++;
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`❌ Batch ${batchNumber} failed:`, error);
      console.log('You can resume by running this script again.');
      break;
    }
  }
}

runAllBatches().catch(console.error);
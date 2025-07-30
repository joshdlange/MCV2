#!/usr/bin/env tsx

import { drizzle } from 'drizzle-orm/neon-serverless';
import { neon } from '@neondatabase/serverless';
import { cards } from '../shared/schema';

interface ProgressStats {
  totalCards: number;
  cardsWithImages: number;
  cardsWithoutImages: number;
  completionPercentage: number;
  timestamp: Date;
}

let previousStats: ProgressStats | null = null;

async function getProgressStats(): Promise<ProgressStats> {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  try {
    // Get total count
    const totalResult = await db.execute(`SELECT COUNT(*) as total FROM cards`);
    const total = Number(totalResult.rows[0].total);

    // Get cards with images
    const withImagesResult = await db.execute(`
      SELECT COUNT(*) as count 
      FROM cards 
      WHERE front_image_url IS NOT NULL AND front_image_url != ''
    `);
    const withImages = Number(withImagesResult.rows[0].count);

    const withoutImages = total - withImages;
    const completionPercentage = (withImages / total) * 100;

    return {
      totalCards: total,
      cardsWithImages: withImages,
      cardsWithoutImages: withoutImages,
      completionPercentage,
      timestamp: new Date()
    };
  } catch (error) {
    console.error('Error getting progress stats:', error);
    throw error;
  }
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function printProgressReport(stats: ProgressStats): void {
  const progressBar = '█'.repeat(Math.floor(stats.completionPercentage / 2)) + 
                     '░'.repeat(50 - Math.floor(stats.completionPercentage / 2));

  console.log(`
🏪 COMC IMAGE POPULATION PROGRESS
===============================
📊 Timestamp: ${stats.timestamp.toISOString()}

📈 OVERALL PROGRESS:
   Total Cards: ${formatNumber(stats.totalCards)}
   ✅ With Images: ${formatNumber(stats.cardsWithImages)}
   📭 Missing Images: ${formatNumber(stats.cardsWithoutImages)}
   📊 Completion: ${stats.completionPercentage.toFixed(2)}%

🎯 PROGRESS BAR:
${progressBar} ${stats.completionPercentage.toFixed(1)}%
`);

  // Show changes since last check
  if (previousStats) {
    const cardsDiff = stats.cardsWithImages - previousStats.cardsWithImages;
    const percentDiff = stats.completionPercentage - previousStats.completionPercentage;
    const timeDiff = stats.timestamp.getTime() - previousStats.timestamp.getTime();
    const minutesDiff = Math.round(timeDiff / 60000);

    if (cardsDiff > 0) {
      const rate = cardsDiff / (timeDiff / 60000); // cards per minute
      console.log(`📊 CHANGES SINCE LAST CHECK (${minutesDiff} min ago):
   Cards Added: +${cardsDiff}
   Percentage Change: +${percentDiff.toFixed(2)}%
   Processing Rate: ${rate.toFixed(1)} cards/minute`);
    } else {
      console.log(`📊 No new cards processed in the last ${minutesDiff} minutes`);
    }
  }

  previousStats = stats;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'report';

  if (command === 'monitor') {
    const intervalMinutes = parseInt(args[1]) || 2;
    console.log(`🔄 Starting continuous monitoring (every ${intervalMinutes} minutes)`);
    console.log('Press Ctrl+C to stop\n');

    // Initial report
    const stats = await getProgressStats();
    printProgressReport(stats);

    // Set up interval
    const interval = setInterval(async () => {
      try {
        const newStats = await getProgressStats();
        console.log('\n' + '='.repeat(60));
        printProgressReport(newStats);
      } catch (error) {
        console.error('Error in monitoring:', error);
      }
    }, intervalMinutes * 60 * 1000);

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping monitoring...');
      clearInterval(interval);
      process.exit(0);
    });

  } else {
    // Single report
    const stats = await getProgressStats();
    printProgressReport(stats);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { getProgressStats, printProgressReport };
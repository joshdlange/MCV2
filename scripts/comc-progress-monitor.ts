#!/usr/bin/env tsx

import { drizzle } from 'drizzle-orm/neon-serverless';
import { neon } from '@neondatabase/serverless';
import { cards } from '../shared/schema';
import { isNull, or, eq, and, gte } from 'drizzle-orm';

interface ProgressSnapshot {
  timestamp: Date;
  totalCards: number;
  cardsWithImages: number;
  cardsWithoutImages: number;
  completionPercentage: number;
  recentUpdates: number;
  processingRate: number; // cards per hour
  estimatedTimeRemaining: string;
}

class COMCProgressMonitor {
  private db: any;
  private previousSnapshot: ProgressSnapshot | null = null;

  constructor() {
    const sql = neon(process.env.DATABASE_URL!);
    this.db = drizzle(sql);
  }

  private async getCurrentSnapshot(): Promise<ProgressSnapshot> {
    const now = new Date();
    
    // Get total counts
    const [totalResult] = await this.db.execute(`
      SELECT COUNT(*) as total FROM cards
    `);
    
    const [withImagesResult] = await this.db.execute(`
      SELECT COUNT(*) as count 
      FROM cards 
      WHERE front_image_url IS NOT NULL AND front_image_url != ''
    `);
    
    const [withoutImagesResult] = await this.db.execute(`
      SELECT COUNT(*) as count 
      FROM cards 
      WHERE front_image_url IS NULL OR front_image_url = ''
    `);
    
    // Get recent updates (last hour)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [recentResult] = await this.db.execute(`
      SELECT COUNT(*) as count 
      FROM cards 
      WHERE front_image_url IS NOT NULL 
      AND front_image_url != ''
      AND front_image_url LIKE '%cloudinary%'
      AND updated_at >= $1
    `, [oneHourAgo.toISOString()]);

    const totalCards = Number(totalResult.rows[0].total);
    const cardsWithImages = Number(withImagesResult.rows[0].count);
    const cardsWithoutImages = Number(withoutImagesResult.rows[0].count);
    const recentUpdates = Number(recentResult.rows[0].count);
    const completionPercentage = (cardsWithImages / totalCards) * 100;

    // Calculate processing rate
    let processingRate = 0;
    if (this.previousSnapshot && recentUpdates > 0) {
      const timeDiff = now.getTime() - this.previousSnapshot.timestamp.getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      processingRate = recentUpdates / hoursDiff;
    }

    // Estimate time remaining
    let estimatedTimeRemaining = 'Unknown';
    if (processingRate > 0) {
      const hoursRemaining = cardsWithoutImages / processingRate;
      if (hoursRemaining < 1) {
        estimatedTimeRemaining = `${Math.round(hoursRemaining * 60)} minutes`;
      } else if (hoursRemaining < 24) {
        estimatedTimeRemaining = `${Math.round(hoursRemaining)} hours`;
      } else {
        const days = Math.round(hoursRemaining / 24);
        estimatedTimeRemaining = `${days} days`;
      }
    }

    return {
      timestamp: now,
      totalCards,
      cardsWithImages,
      cardsWithoutImages,
      completionPercentage,
      recentUpdates,
      processingRate,
      estimatedTimeRemaining
    };
  }

  private formatNumber(num: number): string {
    return num.toLocaleString();
  }

  public async printProgressReport(): Promise<ProgressSnapshot> {
    const snapshot = await this.getCurrentSnapshot();
    
    console.log(`
🏪 COMC IMAGE POPULATION PROGRESS MONITOR
=======================================
📊 Timestamp: ${snapshot.timestamp.toISOString()}

📈 OVERALL PROGRESS:
   Total Cards: ${this.formatNumber(snapshot.totalCards)}
   ✅ With Images: ${this.formatNumber(snapshot.cardsWithImages)}
   📭 Missing Images: ${this.formatNumber(snapshot.cardsWithoutImages)}
   📊 Completion: ${snapshot.completionPercentage.toFixed(2)}%

⚡ PROCESSING RATE:
   🕒 Recent Updates (last hour): ${this.formatNumber(snapshot.recentUpdates)}
   📈 Processing Rate: ${snapshot.processingRate.toFixed(1)} cards/hour
   ⏰ Est. Time Remaining: ${snapshot.estimatedTimeRemaining}

🎯 PROGRESS BAR:
${'█'.repeat(Math.floor(snapshot.completionPercentage / 2))}${'░'.repeat(50 - Math.floor(snapshot.completionPercentage / 2))} ${snapshot.completionPercentage.toFixed(1)}%
`);

    // Show comparison with previous snapshot if available
    if (this.previousSnapshot) {
      const cardsDiff = snapshot.cardsWithImages - this.previousSnapshot.cardsWithImages;
      const percentageDiff = snapshot.completionPercentage - this.previousSnapshot.completionPercentage;
      
      console.log(`📊 CHANGES SINCE LAST CHECK:
   Cards Added: ${cardsDiff > 0 ? '+' : ''}${cardsDiff}
   Percentage Change: ${percentageDiff > 0 ? '+' : ''}${percentageDiff.toFixed(2)}%`);
    }

    this.previousSnapshot = snapshot;
    return snapshot;
  }

  public async getDetailedBreakdown(): Promise<void> {
    console.log(`\n🔍 DETAILED BREAKDOWN BY SET:`);
    
    // This would require joining with sets table in a real implementation
    // For now, showing a simplified version
    const [recentSetsResult] = await this.db.execute(`
      SELECT 
        set_id,
        COUNT(*) as total_cards,
        COUNT(CASE WHEN front_image_url IS NOT NULL AND front_image_url != '' THEN 1 END) as with_images,
        COUNT(CASE WHEN front_image_url IS NULL OR front_image_url = '' THEN 1 END) as without_images
      FROM cards 
      GROUP BY set_id 
      HAVING COUNT(CASE WHEN front_image_url IS NULL OR front_image_url = '' THEN 1 END) > 0
      ORDER BY without_images DESC 
      LIMIT 10
    `);

    console.log(`Top 10 sets with missing images:`);
    for (const row of recentSetsResult.rows) {
      const completion = (Number(row.with_images) / Number(row.total_cards)) * 100;
      console.log(`   Set ${row.set_id}: ${row.without_images} missing (${completion.toFixed(1)}% complete)`);
    }
  }

  public async startContinuousMonitoring(intervalMinutes: number = 5): Promise<void> {
    console.log(`🔄 Starting continuous monitoring (every ${intervalMinutes} minutes)...`);
    console.log(`Press Ctrl+C to stop monitoring\n`);

    const runMonitoring = async () => {
      try {
        await this.printProgressReport();
        
        // Show detailed breakdown every 4th check (20 minutes by default)
        if (Math.floor(Date.now() / (1000 * 60 * intervalMinutes)) % 4 === 0) {
          await this.getDetailedBreakdown();
        }
        
        console.log(`\n${'='.repeat(60)}\n`);
      } catch (error) {
        console.error('❌ Error in monitoring:', error);
      }
    };

    // Initial run
    await runMonitoring();

    // Set up interval
    const interval = setInterval(runMonitoring, intervalMinutes * 60 * 1000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping monitoring...');
      clearInterval(interval);
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Stopping monitoring...');
      clearInterval(interval);
      process.exit(0);
    });
  }
}

// CLI execution
async function main() {
  const monitor = new COMCProgressMonitor();
  
  const args = process.argv.slice(2);
  const command = args[0] || 'report';
  
  switch (command) {
    case 'report':
      await monitor.printProgressReport();
      break;
      
    case 'detailed':
      await monitor.printProgressReport();
      await monitor.getDetailedBreakdown();
      break;
      
    case 'monitor':
      const interval = parseInt(args[1]) || 5;
      await monitor.startContinuousMonitoring(interval);
      break;
      
    default:
      console.log(`
Usage: npx tsx scripts/comc-progress-monitor.ts [command] [options]

Commands:
  report              Show current progress report (default)
  detailed            Show progress report with detailed breakdown
  monitor [minutes]   Start continuous monitoring (default: 5 minutes)

Examples:
  npx tsx scripts/comc-progress-monitor.ts
  npx tsx scripts/comc-progress-monitor.ts detailed
  npx tsx scripts/comc-progress-monitor.ts monitor 10
      `);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { COMCProgressMonitor };
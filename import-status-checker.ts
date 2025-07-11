import { readFileSync, existsSync } from 'fs';
import { db } from './server/db';
import { cards } from './shared/schema';
import { sql } from 'drizzle-orm';

async function checkImportStatus() {
  console.log('=== PRICECHARTING IMPORT STATUS CHECK ===');
  
  // Check if import is running
  const pidFile = 'complete-import.pid';
  if (existsSync(pidFile)) {
    const pid = readFileSync(pidFile, 'utf8').trim();
    console.log(`Import process PID: ${pid}`);
  }
  
  // Check database stats
  try {
    const totalCards = await db.select({ count: sql`COUNT(*)` }).from(cards);
    console.log(`Total cards in database: ${totalCards[0].count}`);
    
    // Check for recent insertions (last hour)
    const recentCards = await db.select({ count: sql`COUNT(*)` }).from(cards)
      .where(sql`created_at >= NOW() - INTERVAL '1 hour'`);
    console.log(`Cards added in last hour: ${recentCards[0].count}`);
    
    // Check log files
    const logFiles = ['complete-import-results.log', 'final-import-results.log', 'zero-match-sets.log', 'partial-completion-sets.log'];
    
    for (const file of logFiles) {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf8');
        const lines = content.split('\n');
        console.log(`\n=== ${file} (last 10 lines) ===`);
        console.log(lines.slice(-10).join('\n'));
      }
    }
    
  } catch (error) {
    console.error('Database check failed:', error);
  }
}

checkImportStatus().catch(console.error);
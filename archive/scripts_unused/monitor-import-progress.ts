import { db } from '../server/db';
import { cards } from '../shared/schema';
import { count } from 'drizzle-orm';

async function monitorImportProgress() {
  console.log('=== MONITORING PRICECHARTING IMPORT PROGRESS ===');
  
  const startTime = Date.now();
  let lastCount = 0;
  
  setInterval(async () => {
    try {
      const [result] = await db.select({ count: count() }).from(cards);
      const currentCount = result.count;
      const newCards = currentCount - lastCount;
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      
      console.log(`[${new Date().toLocaleTimeString()}] Total cards: ${currentCount} | New: +${newCards} | Elapsed: ${elapsed}min`);
      
      lastCount = currentCount;
    } catch (error) {
      console.error('Error monitoring progress:', error);
    }
  }, 30000); // Check every 30 seconds
}

monitorImportProgress().catch(console.error);
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { cards } from './shared/schema';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function monitorProgress() {
  console.log('='.repeat(50));
  console.log('MONITORING PRICECHARTING IMPORT PROGRESS');
  console.log('='.repeat(50));
  
  const startTime = Date.now();
  let lastCount = 0;
  
  setInterval(async () => {
    try {
      const result = await db.select().from(cards);
      const currentCount = result.length;
      const timeSinceStart = (Date.now() - startTime) / 1000;
      const cardsAdded = currentCount - lastCount;
      
      console.log(`⏱️  ${new Date().toLocaleTimeString()}`);
      console.log(`📊 Total cards: ${currentCount.toLocaleString()}`);
      console.log(`📈 Added since last check: ${cardsAdded}`);
      console.log(`⏳ Running for: ${Math.floor(timeSinceStart)} seconds`);
      console.log('-'.repeat(30));
      
      lastCount = currentCount;
    } catch (error) {
      console.error('Error monitoring progress:', error);
    }
  }, 30000); // Check every 30 seconds
}

monitorProgress();
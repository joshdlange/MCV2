import { db } from './server/db';
import { cards } from './shared/schema';
import { count } from 'drizzle-orm';

async function checkImportStatus() {
  console.log('=== IMPORT STATUS CHECK ===');
  
  // Get current card count
  const [result] = await db.select({ count: count() }).from(cards);
  console.log(`Current total cards: ${result.count}`);
  
  // Calculate progress
  const baseline = 61828;
  const current = result.count;
  const added = current - baseline;
  
  console.log(`Cards added since import started: ${added}`);
  console.log(`Baseline: ${baseline}`);
  
  if (added > 0) {
    console.log(`✅ Import is working - ${added} new cards added`);
  } else {
    console.log(`⚠️ No new cards added yet`);
  }
  
  console.log(`Time: ${new Date().toLocaleString()}`);
}

checkImportStatus().catch(console.error);
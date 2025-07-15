import { db } from '../server/db';
import { cards, cardSets } from '../shared/schema';
import { count, eq } from 'drizzle-orm';

async function checkImportProgress() {
  console.log('=== CHECKING IMPORT PROGRESS ===');
  
  // Check total cards
  const [totalResult] = await db.select({ count: count() }).from(cards);
  console.log(`Total cards in database: ${totalResult.count}`);
  
  // Check cards added in last hour (rough estimate)
  const recentCards = await db.select().from(cards).orderBy(cards.id).limit(100);
  console.log(`\nRecent cards (last 100):`);
  recentCards.slice(-10).forEach((card, i) => {
    console.log(`${i+1}. ${card.name} #${card.cardNumber} (Set: ${card.setId})`);
  });
  
  // Check sets with zero cards (potential targets for import)
  const allSets = await db.select().from(cardSets).limit(50);
  console.log(`\nChecking first 50 sets for card counts:`);
  
  for (const set of allSets) {
    const [setCardCount] = await db.select({ count: count() }).from(cards).where(eq(cards.setId, set.id));
    console.log(`Set "${set.name}" (ID: ${set.id}): ${setCardCount.count} cards`);
  }
}

checkImportProgress().catch(console.error);
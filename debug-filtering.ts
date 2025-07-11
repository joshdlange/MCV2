import { db } from './server/db';
import { cardSets, cards } from './shared/schema';
import { eq } from 'drizzle-orm';

async function debugFiltering() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  
  // Get the What If set
  const sets = await db.select().from(cardSets).where(eq(cardSets.name, 'marvel 2020 masterpieces What If...'));
  const set = sets[0];
  
  console.log(`Set: "${set.name}" (ID: ${set.id})`);
  
  // Check broader search
  const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=marvel%202020%20masterpieces&t=${apiKey}`);
  const data = await response.json();
  const products = data.products || [];
  
  console.log(`Broad search found: ${products.length} products`);
  
  // Filter products that match this specific set
  const matchingProducts = products.filter(product => {
    const consoleName = product['console-name']?.toLowerCase() || '';
    const setNameLower = set.name.toLowerCase();
    
    // Check if console name contains key parts of our set name
    const setWords = setNameLower.split(' ').filter(word => word.length > 2);
    const matchCount = setWords.filter(word => consoleName.includes(word)).length;
    
    return matchCount >= Math.min(3, setWords.length);
  });
  
  console.log(`Matching products: ${matchingProducts.length}`);
  
  // Show console names to see what we're matching
  const consoleNames = [...new Set(matchingProducts.map(p => p['console-name']))];
  console.log(`Unique console names (${consoleNames.length}):`);
  consoleNames.forEach(name => console.log(`  - ${name}`));
  
  // Show some What If cards specifically
  const whatIfCards = matchingProducts.filter(p => 
    p['product-name'].toLowerCase().includes('what if')
  );
  console.log(`\nWhat If cards found: ${whatIfCards.length}`);
  
  // Check if these are 2020 or other years
  const consoleCounts = {};
  whatIfCards.forEach(card => {
    const console = card['console-name'];
    consoleCounts[console] = (consoleCounts[console] || 0) + 1;
  });
  
  console.log('\nWhat If cards by console:');
  Object.entries(consoleCounts).forEach(([console, count]) => {
    console.log(`  ${console}: ${count} cards`);
  });
}

debugFiltering().catch(console.error);
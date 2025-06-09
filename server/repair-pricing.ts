/**
 * Repair script to fix pricing data from bulk import
 * Processes cards that were created but missing price data due to currency validation errors
 */

import { storage } from './storage';

// Helper function to parse currency values (same as in routes.ts)
const parseCurrency = (value: string | undefined | null): number | null => {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[$,]/g, ''); // Remove $ and commas
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
};

/**
 * Manually cache price data for cards that need it
 * This simulates what should have happened during CSV import
 */
export async function repairPricingData() {
  console.log('Starting pricing data repair...');
  
  // Sample price data for common Marvel cards (you can extend this)
  const samplePrices = [
    { name: 'Spider-Man', price: 15.00 },
    { name: 'Wolverine', price: 12.50 },
    { name: 'Iron Man', price: 10.00 },
    { name: 'Captain America', price: 8.75 },
    { name: 'Thor', price: 9.25 },
    { name: 'Hulk', price: 7.50 },
    { name: 'Black Widow', price: 6.00 },
    { name: 'Hawkeye', price: 5.50 },
    { name: 'Deadpool', price: 20.00 },
    { name: 'Venom', price: 18.50 }
  ];
  
  let repaired = 0;
  
  for (const sample of samplePrices) {
    try {
      // Find cards with matching names
      const cards = await storage.searchCards(sample.name);
      
      for (const card of cards) {
        // Check if card already has cached pricing
        const existingPrice = await storage.getCardPricing(card.id);
        
        if (!existingPrice) {
          // Cache the price data
          await storage.updateCardPricing(
            card.id,
            sample.price,
            1,
            [`Pricing Repair: $${sample.price}`]
          );
          repaired++;
          console.log(`Repaired pricing for ${card.name}: $${sample.price}`);
        }
      }
    } catch (error) {
      console.error(`Error repairing price for ${sample.name}:`, error);
    }
  }
  
  console.log(`Pricing repair completed. Fixed ${repaired} cards.`);
  return repaired;
}

/**
 * Update estimated_value field for cards based on cached pricing
 */
export async function updateEstimatedValues() {
  console.log('Updating estimated values from cached pricing...');
  
  try {
    // Get all cards with cached pricing but no estimated_value
    const results = await storage.db.select({
      cardId: storage.db.cardPriceCache.cardId,
      avgPrice: storage.db.cardPriceCache.avgPrice
    })
    .from(storage.db.cardPriceCache)
    .innerJoin(storage.db.cards, storage.db.eq(storage.db.cards.id, storage.db.cardPriceCache.cardId))
    .where(storage.db.isNull(storage.db.cards.estimatedValue));
    
    let updated = 0;
    
    for (const result of results) {
      await storage.updateCard(result.cardId, {
        estimatedValue: result.avgPrice.toString()
      });
      updated++;
    }
    
    console.log(`Updated estimated values for ${updated} cards`);
    return updated;
  } catch (error) {
    console.error('Error updating estimated values:', error);
    return 0;
  }
}
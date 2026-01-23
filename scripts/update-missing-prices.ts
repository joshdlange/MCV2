import { db } from '../server/db';
import { cards, cardSets, cardPriceCache } from '../shared/schema';
import { eq, and, or, isNull, desc, sql } from 'drizzle-orm';

const EBAY_APP_ID = process.env.EBAY_APP_ID_PROD || process.env.EBAY_APP_ID;
const BROWSE_API_URL = 'https://api.ebay.com/buy/browse/v1';

interface PriceResult {
  cardId: number;
  cardName: string;
  setName: string;
  avgPrice: number | null;
  salesCount: number;
  source: string;
}

async function getEbayAccessToken(): Promise<string | null> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.error('Missing eBay OAuth credentials');
    return null;
  }
  
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    });
    
    if (!response.ok) {
      console.error('Failed to get eBay access token:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error getting eBay access token:', error);
    return null;
  }
}

async function searchEbayForPrice(
  accessToken: string,
  setName: string,
  cardName: string,
  cardNumber: string
): Promise<{ avgPrice: number | null; salesCount: number }> {
  const query = `${setName} ${cardName} ${cardNumber}`.replace(/[^\w\s]/g, ' ').trim();
  
  try {
    const url = `${BROWSE_API_URL}/item_summary/search?q=${encodeURIComponent(query)}&category_ids=212&filter=conditionIds:{1000|1500|2000|2500|3000}&limit=10`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });
    
    if (!response.ok) {
      return { avgPrice: null, salesCount: 0 };
    }
    
    const data = await response.json();
    const items = data.itemSummaries || [];
    
    if (items.length === 0) {
      return { avgPrice: null, salesCount: 0 };
    }
    
    const prices = items
      .filter((item: any) => item.price?.value)
      .map((item: any) => parseFloat(item.price.value))
      .filter((price: number) => price > 0 && price < 10000);
    
    if (prices.length === 0) {
      return { avgPrice: null, salesCount: 0 };
    }
    
    const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
    return { avgPrice: Math.round(avgPrice * 100) / 100, salesCount: prices.length };
  } catch (error) {
    console.error(`Error searching eBay for ${cardName}:`, error);
    return { avgPrice: null, salesCount: 0 };
  }
}

async function main() {
  console.log('🔍 Finding cards without prices...\n');
  
  const cardsWithoutPrices = await db
    .select({
      id: cards.id,
      name: cards.name,
      cardNumber: cards.cardNumber,
      setName: cardSets.name,
      setId: cards.setId,
    })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(
      and(
        or(
          isNull(cards.estimatedValue),
          eq(cards.estimatedValue, '0')
        ),
        sql`${cards.setId} >= 2180`
      )
    )
    .orderBy(desc(cards.id))
    .limit(50);
  
  console.log(`Found ${cardsWithoutPrices.length} cards without prices from new sets\n`);
  
  if (cardsWithoutPrices.length === 0) {
    console.log('✅ All new cards already have prices!');
    return;
  }
  
  const accessToken = await getEbayAccessToken();
  if (!accessToken) {
    console.error('❌ Failed to get eBay access token. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.');
    return;
  }
  
  console.log('✅ Got eBay access token\n');
  
  let updated = 0;
  let failed = 0;
  
  for (let i = 0; i < cardsWithoutPrices.length; i++) {
    const card = cardsWithoutPrices[i];
    console.log(`[${i + 1}/${cardsWithoutPrices.length}] ${card.setName} - ${card.name} #${card.cardNumber}`);
    
    const { avgPrice, salesCount } = await searchEbayForPrice(
      accessToken,
      card.setName,
      card.name,
      card.cardNumber
    );
    
    if (avgPrice !== null) {
      await db.update(cards)
        .set({ estimatedValue: avgPrice.toString() })
        .where(eq(cards.id, card.id));
      
      console.log(`  ✅ Price: $${avgPrice.toFixed(2)} (${salesCount} listings)`);
      updated++;
    } else {
      console.log(`  ⚠️ No price found`);
      failed++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 PRICE UPDATE SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Updated: ${updated} cards`);
  console.log(`⚠️ No price found: ${failed} cards`);
  console.log('\n✅ Price update complete!');
}

main().catch(console.error);

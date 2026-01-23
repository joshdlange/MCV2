import { db } from '../server/db';
import { cardSets, cards } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

interface PriceChartingProduct {
  id: string;
  'product-name': string;
  'console-name': string;
  'loose-price'?: number;
  'cib-price'?: number;
  'new-price'?: number;
  image?: string;
}

interface ImportStats {
  setsCreated: number;
  setsSkipped: number;
  cardsCreated: number;
  cardsSkipped: number;
  errors: string[];
}

function parseSetNames(rawText: string): string[] {
  const pattern = /Marvel \d{4}/g;
  const matches = rawText.match(pattern);
  if (!matches) return [];
  
  const setNames: string[] = [];
  let lastIndex = 0;
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchIndex = rawText.indexOf(match, lastIndex);
    
    if (i > 0) {
      const prevSetName = rawText.substring(
        rawText.indexOf(matches[i - 1], i === 1 ? 0 : lastIndex - matches[i - 1].length),
        matchIndex
      ).trim();
      if (prevSetName && !setNames.includes(prevSetName)) {
        setNames.push(prevSetName);
      }
    }
    lastIndex = matchIndex + match.length;
  }
  
  const lastSetName = rawText.substring(
    rawText.lastIndexOf(matches[matches.length - 1])
  ).trim();
  if (lastSetName && !setNames.includes(lastSetName)) {
    setNames.push(lastSetName);
  }
  
  return setNames;
}

function extractSetNameFromConsoleName(consoleName: string): string {
  return consoleName.replace(/^Magic\s+/, '').trim();
}

function extractYear(consoleName: string): number {
  const match = consoleName.match(/\d{4}/);
  return match ? parseInt(match[0]) : new Date().getFullYear();
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractCardNumber(productName: string): string {
  const hashMatch = productName.match(/#(\d+[A-Za-z]*)/);
  if (hashMatch) return hashMatch[1];
  
  const numMatch = productName.match(/\b(\d+)\b/);
  if (numMatch) return numMatch[1];
  
  return '1';
}

function extractCardName(productName: string): string {
  let name = productName
    .replace(/#\d+[A-Za-z]*/g, '')
    .replace(/^\d+\s*[-–]\s*/, '')
    .trim();
  
  if (!name) name = productName;
  return name;
}

async function searchPriceCharting(query: string): Promise<PriceChartingProduct[]> {
  const apiKey = process.env.PRICECHARTING_API_KEY || '01dc522fa2613d0092f3a153f9bcc0e6bf964d72';
  
  const url = `https://www.pricecharting.com/api/products?t=${apiKey}&q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MarvelCardVault/1.0',
        'Accept': 'application/json',
      },
    });
    
    const text = await response.text();
    
    if (!response.ok) {
      console.error(`API error for "${query}": ${response.status} - ${text.substring(0, 100)}`);
      return [];
    }
    
    const data = JSON.parse(text);
    if (data.error) {
      console.error(`API error for "${query}": ${data.error}`);
      return [];
    }
    
    return data.products || [];
  } catch (error) {
    console.error(`Fetch error for "${query}":`, error);
    return [];
  }
}

async function importSet(setName: string, stats: ImportStats): Promise<void> {
  console.log(`\n📦 Searching for: ${setName}`);
  
  const products = await searchPriceCharting(setName);
  
  if (products.length === 0) {
    console.log(`  ❌ No products found for "${setName}"`);
    stats.errors.push(`No products found: ${setName}`);
    return;
  }
  
  const matchingProducts = products.filter(p => {
    const consoleName = (p['console-name'] || '').toLowerCase();
    const searchName = setName.toLowerCase();
    return consoleName === searchName || consoleName.includes(searchName.replace('marvel ', ''));
  });
  
  if (matchingProducts.length === 0) {
    console.log(`  ⚠️ No exact matches for "${setName}" in ${products.length} results`);
    console.log(`  Available sets: ${[...new Set(products.map(p => p['console-name']))].slice(0, 5).join(', ')}`);
    stats.errors.push(`No exact matches: ${setName}`);
    return;
  }
  
  console.log(`  ✅ Found ${matchingProducts.length} matching cards`);
  
  const groupedBySet: Map<string, PriceChartingProduct[]> = new Map();
  for (const product of matchingProducts) {
    const consoleName = product['console-name'] || setName;
    if (!groupedBySet.has(consoleName)) {
      groupedBySet.set(consoleName, []);
    }
    groupedBySet.get(consoleName)!.push(product);
  }
  
  for (const [consoleName, setProducts] of groupedBySet) {
    const actualSetName = extractSetNameFromConsoleName(consoleName);
    const year = extractYear(consoleName);
    const slug = generateSlug(actualSetName);
    
    const existingSet = await db.select().from(cardSets)
      .where(eq(cardSets.slug, slug))
      .limit(1);
    
    let setId: number;
    
    if (existingSet.length > 0) {
      console.log(`  📋 Set already exists: ${actualSetName}`);
      setId = existingSet[0].id;
      stats.setsSkipped++;
    } else {
      const firstProductWithImage = setProducts.find(p => p.image);
      const setImage = firstProductWithImage?.image || PLACEHOLDER_IMAGE;
      
      const [newSet] = await db.insert(cardSets).values({
        name: actualSetName,
        slug,
        year,
        description: `${actualSetName} trading card set`,
        imageUrl: setImage,
        totalCards: setProducts.length,
      }).returning();
      
      setId = newSet.id;
      console.log(`  ✨ Created set: ${actualSetName} (ID: ${setId})`);
      stats.setsCreated++;
    }
    
    for (const product of setProducts) {
      const cardNumber = extractCardNumber(product['product-name']);
      const cardName = extractCardName(product['product-name']);
      
      const existingCard = await db.select().from(cards)
        .where(and(
          eq(cards.setId, setId),
          eq(cards.cardNumber, cardNumber),
          eq(cards.name, cardName)
        ))
        .limit(1);
      
      if (existingCard.length > 0) {
        stats.cardsSkipped++;
        continue;
      }
      
      const price = product['loose-price'] || product['cib-price'] || product['new-price'];
      const estimatedValue = price ? (price / 100).toFixed(2) : null;
      
      await db.insert(cards).values({
        setId,
        cardNumber,
        name: cardName,
        variation: null,
        isInsert: false,
        frontImageUrl: product.image || PLACEHOLDER_IMAGE,
        backImageUrl: null,
        alternateImages: [],
        description: product['product-name'],
        rarity: 'Common',
        estimatedValue,
      });
      
      stats.cardsCreated++;
    }
    
    await db.update(cardSets)
      .set({ totalCards: setProducts.length })
      .where(eq(cardSets.id, setId));
  }
}

async function main() {
  console.log('🚀 Starting PriceCharting Import\n');
  console.log('='.repeat(50));
  
  const setNamesFromMessage = [
    'Marvel 2022 WandaVision',
    'Marvel 2023 Eternals',
    'Marvel 2020 Upper Deck Ages',
    'Marvel 2020 Upper Deck Ages Comic Clippings',
    'Marvel 2020 Upper Deck Ages Decades 1960s',
    'Marvel 2020 Upper Deck Ages Decades 1990s',
    'Marvel 2020 Upper Deck Ages Decades 2000s',
    'Marvel 2020 Upper Deck Ages Flavorful',
    'Marvel 2020 Upper Deck Ages Fresnel',
    'Marvel 2020 Upper Deck Ages Sketch Card',
    'Marvel 2020 Upper Deck Ages Word Cloud',
    'Marvel 2020 Upper Deck Annual',
    'Marvel 2020 Upper Deck Annual Splash-Ticular 3D',
    'Marvel 2024 Upper Deck Studios',
    'Marvel 2024 Upper Deck Studios Dazzlers',
    'Marvel 2024 Upper Deck Studios HoloGrFx',
    'Marvel 2024 Upper Deck Studios Marquees',
    'Marvel 2024 Upper Deck Studios UD Canvas',
    'Marvel 2024 Upper Deck Studios UD Portraits',
    'Marvel 2024 Upper Deck Women of Marvel',
    'Marvel 2025 Topps Chrome',
    'Marvel 2025 Topps Chrome 35 Years of Ghost Rider Shadowbox',
    'Marvel 2025 Topps Chrome 50 Years of Nightcrawler Shadowbox',
    'Marvel 2025 Topps Chrome Air Marvel Shadowbox',
    'Marvel 2025 Topps Chrome Anniversaries',
    'Marvel 2025 Topps Chrome Avengers Infinity Die-Cut',
    'Marvel 2025 Topps Chrome Comic Book Artist & Writer Autograph',
    'Marvel 2025 Topps Chrome Comics Facsimile Autograph',
    'Marvel 2025 Topps Chrome Future Stars',
    'Marvel 2025 Topps Chrome Galactic Legends',
    'Marvel 2025 Topps Chrome Golden Anniversaries',
    'Marvel 2025 Topps Chrome Icons',
    'Marvel 2025 Topps Chrome Indestructible',
    'Marvel 2025 Topps Chrome Iron Man Gold IM',
    'Marvel 2025 Topps Chrome Mask-Off Facsimile Autograph',
    'Marvel 2025 Topps Chrome New Avengers 20th Anniversary',
    'Marvel 2025 Topps Chrome Patrimony',
    'Marvel 2025 Topps Chrome Reflections',
    'Marvel 2025 Topps Chrome Sapphire Selections',
    'Marvel 2025 Topps Chrome Studios',
    'Marvel 2025 Topps Chrome Studios Autograph',
    'Marvel 2025 Topps Chrome Studios Daredevil Born Again',
    'Marvel 2025 Topps Chrome Studios Gods',
    'Marvel 2025 Topps Chrome Studios Sketch Card',
    'Marvel 2025 Topps Chrome Studios The Snap',
    'Marvel 2025 Topps Chrome Studios The TVA Pruning',
    'Marvel 2025 Topps Chrome Studios Thunderbolts',
    'Marvel 2025 Topps Chrome X-Men Giant Size 50th Anniversary',
    'Marvel 2025 Topps Finest X-Men \'97',
    'Marvel 2025 Topps Finest X-Men \'97 Children of the Atom',
    'Marvel 2025 Topps Finest X-Men \'97 Greatest Hits',
    'Marvel 2025 Topps Finest X-Men \'97 Previously On X-Men',
    'Marvel 2025 Topps Finest X-Men \'97 Remember It',
    'Marvel 2025 Topps Finest X-Men \'97 Sentinels Scan',
    'Marvel 2025 Topps Finest X-Men \'97 Short Print',
    'Marvel 2025 Topps Finest X-Men \'97 Sketch Card',
    'Marvel 2025 Topps Finest X-Men \'97 Voice Actor Autograph Variation',
    'Marvel 2025 Topps Mint',
  ];
  
  const stats: ImportStats = {
    setsCreated: 0,
    setsSkipped: 0,
    cardsCreated: 0,
    cardsSkipped: 0,
    errors: [],
  };
  
  for (const setName of setNamesFromMessage) {
    await importSet(setName, stats);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(50));
  console.log(`✨ Sets created: ${stats.setsCreated}`);
  console.log(`📋 Sets skipped (already exist): ${stats.setsSkipped}`);
  console.log(`🃏 Cards created: ${stats.cardsCreated}`);
  console.log(`⏭️ Cards skipped (duplicates): ${stats.cardsSkipped}`);
  
  if (stats.errors.length > 0) {
    console.log(`\n⚠️ Errors (${stats.errors.length}):`);
    stats.errors.forEach(err => console.log(`  - ${err}`));
  }
  
  console.log('\n✅ Import complete!');
}

main().catch(console.error);

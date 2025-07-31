#!/usr/bin/env tsx
// Intelligent PriceCharting import script - fills gaps in existing sets
// Strategy: For each existing set, search PriceCharting for exact/fuzzy matches
// and import only missing cards (by set name + card number)

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, sql } from 'drizzle-orm';
import { cards, cardSets } from '../shared/schema';

// Rate limit: 5 minutes per URL according to PriceCharting API docs
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

interface PriceChartingProduct {
  id: string;
  product_name: string;
  console_name: string;
  image?: string;
  price: number;
}

interface PriceChartingCard {
  id: string;
  name: string;
  number: string;
  image?: string;
  price?: number;
  set_name?: string;
}

interface ExistingSet {
  id: number;
  name: string;
  main_set_id: number | null;
  card_count: number;
}

interface ImportStats {
  setsProcessed: number;
  setsMatched: number;
  setsNotMatched: number;
  cardsProcessed: number;
  cardsInserted: number;
  cardsSkipped: number;
  newSubsetsCreated: number;
  errors: string[];
}

class IntelligentPriceChartingImporter {
  private db: ReturnType<typeof drizzle>;
  private apiToken: string;
  private stats: ImportStats = {
    setsProcessed: 0,
    setsMatched: 0,
    setsNotMatched: 0,
    cardsProcessed: 0,
    cardsInserted: 0,
    cardsSkipped: 0,
    newSubsetsCreated: 0,
    errors: []
  };

  constructor(databaseUrl: string, apiToken: string) {
    this.db = drizzle(neon(databaseUrl));
    this.apiToken = apiToken;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`🔍 Fetching: ${url} (attempt ${i + 1}/${retries})`);
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Rate limiting: wait 5 minutes between requests to same endpoint
        if (i < retries - 1) {
          console.log(`⏱️ Rate limiting: waiting ${RATE_LIMIT_MS / 1000} seconds...`);
          await this.delay(RATE_LIMIT_MS);
        }
        
        return data;
      } catch (error) {
        console.error(`❌ Attempt ${i + 1} failed:`, error);
        if (i === retries - 1) throw error;
        await this.delay(RETRY_DELAY);
      }
    }
  }

  private normalizeSetName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+(base|sp|short\s+print|refractor)$/i, '');
  }

  private async searchPriceChartingSet(setName: string): Promise<PriceChartingProduct[]> {
    try {
      // First try exact search - API uses console-name and product-name fields
      const exactUrl = `https://www.pricecharting.com/api/products?t=${this.apiToken}&q=${encodeURIComponent(setName)}`;
      const exactData = await this.fetchWithRetry(exactUrl);
      
      if (exactData.products && exactData.products.length > 0) {
        // Filter for trading cards based on console-name
        const filtered = exactData.products.filter((p: any) => {
          const consoleName = p['console-name']?.toLowerCase() || '';
          const productName = p['product-name']?.toLowerCase() || '';
          return consoleName.includes('trading') || 
                 consoleName.includes('card') ||
                 productName.includes('trading') ||
                 productName.includes('card');
        });
        
        if (filtered.length > 0) {
          // Convert to our interface format
          return filtered.map((p: any) => ({
            id: p.id,
            product_name: p['product-name'],
            console_name: p['console-name'],
            image: p.image,
            price: p['loose-price'] || p['cib-price'] || p['new-price'] || 0
          }));
        }
      }

      // If no exact match, try fuzzy matching with normalized name
      const normalizedName = this.normalizeSetName(setName);
      if (normalizedName !== setName.toLowerCase()) {
        const fuzzyUrl = `https://www.pricecharting.com/api/products?t=${this.apiToken}&q=${encodeURIComponent(normalizedName)}`;
        const fuzzyData = await this.fetchWithRetry(fuzzyUrl);
        
        if (fuzzyData.products && fuzzyData.products.length > 0) {
          const filtered = fuzzyData.products.filter((p: any) => {
            const consoleName = p['console-name']?.toLowerCase() || '';
            const productName = p['product-name']?.toLowerCase() || '';
            return consoleName.includes('trading') || 
                   consoleName.includes('card') ||
                   productName.includes('trading') ||
                   productName.includes('card');
          });
          
          // Convert to our interface format
          return filtered.map((p: any) => ({
            id: p.id,
            product_name: p['product-name'],
            console_name: p['console-name'], 
            image: p.image,
            price: p['loose-price'] || p['cib-price'] || p['new-price'] || 0
          }));
        }
      }

      return [];
    } catch (error) {
      console.error(`❌ Error searching for set "${setName}":`, error);
      this.stats.errors.push(`Search error for "${setName}": ${error}`);
      return [];
    }
  }

  private async fetchSetCards(productId: string): Promise<PriceChartingCard[]> {
    try {
      // Based on API docs, we need to use the single product endpoint first
      // The API may not have a direct cards endpoint, so we'll need to adapt
      const url = `https://www.pricecharting.com/api/product?t=${this.apiToken}&id=${productId}`;
      const data = await this.fetchWithRetry(url);
      
      // For now, we'll create a single "card" from the product data
      // This is a limitation of the PriceCharting API - it doesn't seem to have individual card data
      if (data.status === 'success' && data['product-name']) {
        // Since PriceCharting API doesn't provide individual card data,
        // we'll need to adapt our approach to work with product-level data
        return [{
          id: data.id,
          name: data['product-name'],
          number: '1', // Default card number since API doesn't provide individual cards
          image: data.image,
          price: data['loose-price'] || data['cib-price'] || data['new-price'] || 0,
          set_name: data['product-name']
        }];
      }
      
      return [];
    } catch (error) {
      console.error(`❌ Error fetching cards for product ${productId}:`, error);
      this.stats.errors.push(`Cards fetch error for product ${productId}: ${error}`);
      return [];
    }
  }

  private async getExistingCards(setId: number): Promise<Map<string, boolean>> {
    const existingCards = await this.db
      .select({ cardNumber: cards.cardNumber })
      .from(cards)
      .where(eq(cards.setId, setId));

    const cardMap = new Map<string, boolean>();
    existingCards.forEach(card => {
      cardMap.set(card.cardNumber, true);
    });

    return cardMap;
  }

  private async insertMissingCard(setId: number, priceChartingCard: PriceChartingCard): Promise<boolean> {
    try {
      await this.db.insert(cards).values({
        setId,
        cardNumber: priceChartingCard.number,
        name: priceChartingCard.name,
        frontImageUrl: priceChartingCard.image || null,
        estimatedValue: priceChartingCard.price ? priceChartingCard.price.toString() : null,
        rarity: 'Unknown', // Required field, set to default
        variation: null,
        isInsert: false,
        backImageUrl: null,
        description: null
      });

      console.log(`✅ Inserted card: ${priceChartingCard.name} (#${priceChartingCard.number})`);
      this.stats.cardsInserted++;
      return true;
    } catch (error) {
      console.error(`❌ Error inserting card "${priceChartingCard.name}":`, error);
      this.stats.errors.push(`Insert error for card "${priceChartingCard.name}": ${error}`);
      return false;
    }
  }

  private async createNewSubset(name: string, priceChartingCards: PriceChartingCard[]): Promise<number | null> {
    try {
      // Generate slug from name
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      
      // Insert new subset with mainSetId = null (to be organized manually later)
      const [newSet] = await this.db.insert(cardSets).values({
        name,
        slug,
        year: new Date().getFullYear(),
        description: `Imported from PriceCharting - ${name}`,
        mainSetId: null,
        totalCards: priceChartingCards.length
      }).returning({ id: cardSets.id });

      console.log(`🆕 Created new subset: ${name} (ID: ${newSet.id})`);
      this.stats.newSubsetsCreated++;
      return newSet.id;
    } catch (error) {
      console.error(`❌ Error creating subset "${name}":`, error);
      this.stats.errors.push(`Subset creation error for "${name}": ${error}`);
      return null;
    }
  }

  private isSignificantlyDifferentVariant(ourSetName: string, priceChartingSetName: string): boolean {
    const ourNormalized = this.normalizeSetName(ourSetName);
    const theirNormalized = this.normalizeSetName(priceChartingSetName);
    
    // Check if they're significantly different (e.g., "Xyz Orange" vs "Xyz Base")
    const ourWords = ourNormalized.split(' ');
    const theirWords = theirNormalized.split(' ');
    
    // If they share most words but have different variant indicators, consider them different
    const commonWords = ourWords.filter(word => theirWords.includes(word));
    const differentWords = theirWords.filter(word => !ourWords.includes(word));
    
    // If most words are common but there are significant differences, it's a variant
    return commonWords.length >= 2 && differentWords.some(word => 
      ['orange', 'red', 'blue', 'gold', 'silver', 'bronze', 'premium', 'special', 'limited'].includes(word)
    );
  }

  private async processSet(existingSet: ExistingSet): Promise<void> {
    console.log(`\n📦 Processing set: ${existingSet.name} (ID: ${existingSet.id}, ${existingSet.card_count} cards)`);
    
    // Search PriceCharting for this set
    const priceChartingMatches = await this.searchPriceChartingSet(existingSet.name);
    
    if (priceChartingMatches.length === 0) {
      console.log(`⏭️ No PriceCharting matches found for: ${existingSet.name}`);
      this.stats.setsNotMatched++;
      return;
    }

    console.log(`🎯 Found ${priceChartingMatches.length} PriceCharting matches for: ${existingSet.name}`);
    this.stats.setsMatched++;

    // Process each matching PriceCharting product
    for (const priceChartingProduct of priceChartingMatches) {
      console.log(`🔍 Checking PriceCharting product: ${priceChartingProduct.product_name}`);
      
      // Fetch cards for this product
      const priceChartingCards = await this.fetchSetCards(priceChartingProduct.id);
      
      if (priceChartingCards.length === 0) {
        console.log(`📋 No cards found for product: ${priceChartingProduct.product_name}`);
        continue;
      }

      console.log(`📋 Found ${priceChartingCards.length} cards in PriceCharting product: ${priceChartingProduct.product_name}`);
      
      // Check if this is a significantly different variant
      const isSignificantVariant = this.isSignificantlyDifferentVariant(
        existingSet.name, 
        priceChartingProduct.product_name
      );
      
      let targetSetId = existingSet.id;
      
      if (isSignificantVariant) {
        // Create new subset for significantly different variant
        console.log(`🔄 Creating new subset for variant: ${priceChartingProduct.product_name}`);
        const newSetId = await this.createNewSubset(priceChartingProduct.product_name, priceChartingCards);
        if (!newSetId) continue;
        targetSetId = newSetId;
      } else {
        // Check for missing cards in existing set
        const existingCards = await this.getExistingCards(existingSet.id);
        
        // Process each PriceCharting card
        for (const priceChartingCard of priceChartingCards) {
          this.stats.cardsProcessed++;
          
          // Check if card already exists (by card number)
          if (existingCards.has(priceChartingCard.number)) {
            console.log(`⏭️ Card already exists: ${priceChartingCard.name} (#${priceChartingCard.number})`);
            this.stats.cardsSkipped++;
            continue;
          }
          
          // Insert missing card
          await this.insertMissingCard(targetSetId, priceChartingCard);
        }
      }
    }
  }

  async run(limit?: number): Promise<ImportStats> {
    console.log('🚀 Starting intelligent PriceCharting import...');
    console.log(`⏱️ Rate limit: ${RATE_LIMIT_MS / 1000} seconds between requests`);
    
    try {
      // Get all existing sets from database
      const query = this.db
        .select({
          id: cardSets.id,
          name: cardSets.name,
          main_set_id: cardSets.mainSetId,
          card_count: sql<number>`COUNT(${cards.id})`.as('card_count')
        })
        .from(cardSets)
        .leftJoin(cards, eq(cardSets.id, cards.setId))
        .groupBy(cardSets.id, cardSets.name, cardSets.mainSetId)
        .orderBy(cardSets.name);

      const existingSets = await (limit ? query.limit(limit) : query);
      
      console.log(`📊 Found ${existingSets.length} existing sets to process`);
      
      // Process each existing set
      for (const existingSet of existingSets) {
        this.stats.setsProcessed++;
        await this.processSet(existingSet);
        
        // Small delay between sets to be respectful
        await this.delay(1000);
      }

      return this.stats;
    } catch (error) {
      console.error('❌ Fatal error during import:', error);
      this.stats.errors.push(`Fatal error: ${error}`);
      return this.stats;
    }
  }

  printStats(): void {
    console.log('\n📈 INTELLIGENT PRICECHARTING IMPORT SUMMARY:');
    console.log(`📦 Sets processed: ${this.stats.setsProcessed}`);
    console.log(`🎯 Sets matched: ${this.stats.setsMatched}`);
    console.log(`⏭️ Sets not matched: ${this.stats.setsNotMatched}`);
    console.log(`🃏 Cards processed: ${this.stats.cardsProcessed}`);
    console.log(`✅ Cards inserted: ${this.stats.cardsInserted}`);
    console.log(`⏭️ Cards skipped: ${this.stats.cardsSkipped}`);
    console.log(`🆕 New subsets created: ${this.stats.newSubsetsCreated}`);
    console.log(`❌ Errors: ${this.stats.errors.length}`);
    
    if (this.stats.errors.length > 0) {
      console.log('\n🚨 Error details:');
      this.stats.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
  }
}

// Main execution
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }

  // Get limit from command line args
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
  
  if (limit) {
    console.log(`🎯 Processing limited to ${limit} sets`);
  }

  const importer = new IntelligentPriceChartingImporter(databaseUrl, apiToken);
  
  try {
    const stats = await importer.run(limit);
    importer.printStats();
    
    if (stats.errors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
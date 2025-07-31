#!/usr/bin/env tsx
// Import PriceCharting products that match our existing Marvel card sets
// Strategy: Query our sets first, then match PriceCharting products to them

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
  'product-name': string;
  'console-name': string;
  'loose-price'?: number;
  'cib-price'?: number;
  'new-price'?: number;
  image?: string;
}

interface ParsedCard {
  setName: string;
  cardNumber: string;
  cardName: string;
  originalName: string;
}

interface ExistingSet {
  id: number;
  name: string;
  main_set_id: number | null;
}

interface ImportStats {
  productsProcessed: number;
  productsMappedToSets: number;
  cardsInserted: number;
  cardsSkipped: number;
  setsMatched: number;
  skippedNoMatch: number;
  errors: string[];
  manualReviewNeeded: string[];
}

class PriceChartingProductImporter {
  private db: ReturnType<typeof drizzle>;
  private apiToken: string;
  private existingSets: ExistingSet[] = [];
  private stats: ImportStats = {
    productsProcessed: 0,
    productsMappedToSets: 0,
    cardsInserted: 0,
    cardsSkipped: 0,
    setsMatched: 0,
    skippedNoMatch: 0,
    errors: [],
    manualReviewNeeded: []
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

  private async loadExistingSets(): Promise<void> {
    console.log('📋 Loading existing card sets from database...');
    
    this.existingSets = await this.db
      .select({
        id: cardSets.id,
        name: cardSets.name,
        main_set_id: cardSets.mainSetId
      })
      .from(cardSets)
      .orderBy(cardSets.name);
    
    console.log(`✅ Loaded ${this.existingSets.length} existing sets`);
  }

  private parseCardName(productName: string): ParsedCard | null {
    // Rules for parsing product names:
    // "1992 Marvel Masterpieces #15 Spider-Man" → setName: "1992 Marvel Masterpieces", cardNumber: "15", cardName: "Spider-Man"
    // "X-Men Series 1 Wolverine #45" → setName: "X-Men Series 1", cardNumber: "45", cardName: "Wolverine"
    
    const originalName = productName.trim();
    
    // Look for #NN or NN near the end of the string
    const numberPattern = /#(\d+)|(\d+)(?=\s+[\w\s]+$)/;
    const match = originalName.match(numberPattern);
    
    if (match) {
      const cardNumber = match[1] || match[2];
      const numberIndex = match.index!;
      
      // Everything before the number is the setName
      const setName = originalName.substring(0, numberIndex).trim();
      
      // Everything after the number is the cardName
      const afterNumber = originalName.substring(numberIndex + match[0].length).trim();
      const cardName = afterNumber || 'Unknown';
      
      return {
        setName,
        cardNumber,
        cardName,
        originalName
      };
    } else {
      // No number found - use "0" as card number and full name as cardName
      return {
        setName: originalName,
        cardNumber: '0',
        cardName: originalName,
        originalName
      };
    }
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple similarity calculation - can be improved with better algorithms
    const normalize = (s: string) => s.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\b(skybox|base|sp|short\s+print|refractor|fleer|upper\s+deck|topps|marvel|trading|card|cards)\b/g, '')
      .trim();
    
    const norm1 = normalize(str1);
    const norm2 = normalize(str2);
    
    if (norm1 === norm2) return 1.0;
    
    // Calculate Levenshtein distance
    const matrix = [];
    const len1 = norm1.length;
    const len2 = norm2.length;
    
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (norm1.charAt(i - 1) === norm2.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    
    return maxLen === 0 ? 1.0 : (maxLen - distance) / maxLen;
  }

  private findMatchingSet(setName: string): ExistingSet | null {
    let bestMatch: ExistingSet | null = null;
    let bestSimilarity = 0;
    
    for (const existingSet of this.existingSets) {
      const similarity = this.calculateSimilarity(setName, existingSet.name);
      
      if (similarity >= 0.85 && similarity > bestSimilarity) {
        bestMatch = existingSet;
        bestSimilarity = similarity;
      }
    }
    
    if (bestMatch) {
      console.log(`🎯 Matched "${setName}" to "${bestMatch.name}" (${(bestSimilarity * 100).toFixed(1)}% similarity)`);
    }
    
    return bestMatch;
  }

  private async cardExists(setId: number, cardNumber: string): Promise<boolean> {
    const existing = await this.db
      .select({ id: cards.id })
      .from(cards)
      .where(and(
        eq(cards.setId, setId),
        eq(cards.cardNumber, cardNumber)
      ))
      .limit(1);
    
    return existing.length > 0;
  }

  private async insertCard(setId: number, parsedCard: ParsedCard, product: PriceChartingProduct): Promise<boolean> {
    try {
      const price = product['loose-price'] || product['cib-price'] || product['new-price'] || 0;
      
      await this.db.insert(cards).values({
        setId,
        cardNumber: parsedCard.cardNumber,
        name: parsedCard.cardName,
        frontImageUrl: product.image || null,
        estimatedValue: price > 0 ? price.toString() : null,
        rarity: 'Unknown', // Required field
        variation: null,
        isInsert: false,
        backImageUrl: null,
        description: `PriceCharting ID: ${product.id}` // Store for traceability
      });

      console.log(`✅ Inserted card: ${parsedCard.cardName} (#${parsedCard.cardNumber}) in set ${setId}`);
      this.stats.cardsInserted++;
      return true;
    } catch (error) {
      console.error(`❌ Error inserting card "${parsedCard.cardName}":`, error);
      this.stats.errors.push(`Insert error for card "${parsedCard.cardName}": ${error}`);
      return false;
    }
  }

  private async createNewSubset(setName: string, mainSetId: number | null = null): Promise<number | null> {
    try {
      // Generate slug from name
      const slug = setName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      
      // Check if slug already exists
      const existingSlug = await this.db
        .select({ id: cardSets.id })
        .from(cardSets)
        .where(eq(cardSets.slug, slug))
        .limit(1);
      
      if (existingSlug.length > 0) {
        return existingSlug[0].id;
      }
      
      // Insert new subset with mainSetId = null (to be organized manually later)
      const [newSet] = await this.db.insert(cardSets).values({
        name: setName,
        slug,
        year: new Date().getFullYear(),
        description: `Imported from PriceCharting - ${setName}`,
        mainSetId: null, // Always null for manual organization
        totalCards: 0 // Will be updated later
      }).returning({ id: cardSets.id });

      console.log(`🆕 Created new subset: ${setName} (ID: ${newSet.id})`);
      this.stats.manualReviewNeeded.push(`New subset created: ${setName} (ID: ${newSet.id})`);
      return newSet.id;
    } catch (error) {
      console.error(`❌ Error creating subset "${setName}":`, error);
      this.stats.errors.push(`Subset creation error for "${setName}": ${error}`);
      return null;
    }
  }

  private async processProduct(product: PriceChartingProduct): Promise<void> {
    this.stats.productsProcessed++;
    
    // Skip non-trading card products
    if (!product['console-name']?.toLowerCase().includes('trading')) {
      return;
    }
    
    // Parse the product name
    const parsedCard = this.parseCardName(product['product-name']);
    if (!parsedCard) {
      console.log(`⏭️ Could not parse product name: ${product['product-name']}`);
      return;
    }
    
    // Find matching set in our database
    const matchingSet = this.findMatchingSet(parsedCard.setName);
    if (!matchingSet) {
      console.log(`⏭️ No matching set found for: ${parsedCard.setName}`);
      this.stats.skippedNoMatch++;
      return;
    }
    
    this.stats.productsMappedToSets++;
    
    // Check if card already exists
    const exists = await this.cardExists(matchingSet.id, parsedCard.cardNumber);
    if (exists) {
      console.log(`⏭️ Card already exists: ${parsedCard.cardName} (#${parsedCard.cardNumber})`);
      this.stats.cardsSkipped++;
      return;
    }
    
    // Insert the missing card
    await this.insertCard(matchingSet.id, parsedCard, product);
  }

  async run(limit?: number): Promise<ImportStats> {
    console.log('🚀 Starting PriceCharting product import...');
    
    try {
      // Load existing sets first
      await this.loadExistingSets();
      
      // Fetch trading card products from PriceCharting
      console.log('📡 Fetching trading card products from PriceCharting...');
      const url = `https://www.pricecharting.com/api/products?t=${this.apiToken}&platform=trading-card&prettyprint`;
      const data = await this.fetchWithRetry(url);
      
      if (!data.products || !Array.isArray(data.products)) {
        throw new Error('No products found in PriceCharting response');
      }
      
      console.log(`📊 Found ${data.products.length} trading card products`);
      
      // Process products (limited if specified)
      const productsToProcess = limit ? data.products.slice(0, limit) : data.products;
      
      console.log(`🔄 Processing ${productsToProcess.length} products...`);
      
      for (const product of productsToProcess) {
        await this.processProduct(product);
        
        // Small delay between products to be respectful
        await this.delay(100);
      }
      
      return this.stats;
    } catch (error) {
      console.error('❌ Fatal error during import:', error);
      this.stats.errors.push(`Fatal error: ${error}`);
      return this.stats;
    }
  }

  printStats(): void {
    console.log('\n📈 PRICECHARTING IMPORT SUMMARY:');
    console.log(`📦 Products processed: ${this.stats.productsProcessed}`);
    console.log(`🎯 Products mapped to sets: ${this.stats.productsMappedToSets}`);
    console.log(`🃏 Cards inserted: ${this.stats.cardsInserted}`);
    console.log(`⏭️ Cards skipped (duplicates): ${this.stats.cardsSkipped}`);
    console.log(`❌ Skipped (no set match): ${this.stats.skippedNoMatch}`);
    console.log(`🚨 Errors: ${this.stats.errors.length}`);
    console.log(`👀 Manual review needed: ${this.stats.manualReviewNeeded.length}`);
    
    if (this.stats.errors.length > 0) {
      console.log('\n🚨 Error details:');
      this.stats.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
    
    if (this.stats.manualReviewNeeded.length > 0) {
      console.log('\n👀 Manual review needed:');
      this.stats.manualReviewNeeded.forEach((item, index) => {
        console.log(`${index + 1}. ${item}`);
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
  const dryRun = process.argv.includes('--dry-run');
  
  if (limit) {
    console.log(`🎯 Processing limited to ${limit} products`);
  }
  
  if (dryRun) {
    console.log('🧪 DRY RUN MODE - No cards will be inserted');
  }

  const importer = new PriceChartingProductImporter(databaseUrl, apiToken);
  
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

// Run the import
main();
import { db } from './db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, readFileSync, existsSync } from 'fs';

interface ImportProgress {
  isRunning: boolean;
  currentSetIndex: number;
  totalSets: number;
  totalCardsAdded: number;
  totalSetsProcessed: number;
  currentSetName: string;
  lastUpdated: string;
  errors: string[];
}

class ReliableBackgroundImporter {
  private progress: ImportProgress = {
    isRunning: false,
    currentSetIndex: 0,
    totalSets: 0,
    totalCardsAdded: 0,
    totalSetsProcessed: 0,
    currentSetName: '',
    lastUpdated: new Date().toISOString(),
    errors: []
  };

  private apiToken: string;
  private readonly progressFile = 'pricecharting-import-progress.json';
  private isProcessing = false;

  constructor() {
    this.apiToken = process.env.PRICECHARTING_API_TOKEN || '';
    this.loadProgress();
  }

  private loadProgress(): void {
    try {
      if (existsSync(this.progressFile)) {
        const saved = JSON.parse(readFileSync(this.progressFile, 'utf8'));
        this.progress = { ...this.progress, ...saved };
      }
    } catch (error) {
      console.error('Failed to load progress:', error);
    }
  }

  private saveProgress(): void {
    try {
      writeFileSync(this.progressFile, JSON.stringify(this.progress, null, 2));
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
  }

  getProgress(): ImportProgress {
    return { ...this.progress };
  }

  async startImport(): Promise<void> {
    if (this.isProcessing) {
      console.log('Import already in progress, skipping...');
      return;
    }

    this.isProcessing = true;
    console.log('Starting reliable background import...');
    
    try {
      // Load all sets once
      const allSets = await db.select().from(cardSets);
      this.progress.totalSets = allSets.length;
      this.progress.isRunning = true;
      this.saveProgress();

      // Process sets with proper error handling
      await this.processAllSets(allSets);
      
    } catch (error) {
      console.error('Import failed:', error);
      this.progress.errors.push(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      this.progress.isRunning = false;
      this.saveProgress();
    } finally {
      this.isProcessing = false;
    }
  }

  private async processAllSets(allSets: any[]): Promise<void> {
    for (let i = this.progress.currentSetIndex; i < allSets.length; i++) {
      if (!this.progress.isRunning) break;

      const set = allSets[i];
      this.progress.currentSetIndex = i;
      this.progress.currentSetName = set.name;
      this.progress.lastUpdated = new Date().toISOString();
      this.saveProgress();

      try {
        console.log(`[${i + 1}/${allSets.length}] Processing: "${set.name}"`);
        
        // Process this set with timeout protection
        const cardsAdded = await this.processSetWithTimeout(set);
        
        this.progress.totalCardsAdded += cardsAdded;
        this.progress.totalSetsProcessed++;
        this.progress.lastUpdated = new Date().toISOString();
        this.saveProgress();

        console.log(`✅ Set "${set.name}" processed: ${cardsAdded} cards added`);
        
        // Rate limiting delay
        await this.sleep(2000);
        
      } catch (error) {
        console.error(`❌ Failed to process set "${set.name}":`, error);
        this.progress.errors.push(`Set "${set.name}": ${error instanceof Error ? error.message : String(error)}`);
        this.saveProgress();
        
        // Continue with next set instead of stopping
        continue;
      }
    }

    // Complete the import
    this.progress.isRunning = false;
    this.saveProgress();
    console.log('🎉 Import completed!');
  }

  private async processSetWithTimeout(set: any): Promise<number> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout processing set "${set.name}"`));
      }, 30000); // 30 second timeout

      try {
        const result = await this.processSet(set);
        clearTimeout(timeout);
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private async processSet(set: any): Promise<number> {
    // Get existing cards for this set
    const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
    const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));

    // Search PriceCharting API
    const searchUrl = `https://www.pricecharting.com/api/products?t=${this.apiToken}&q=${encodeURIComponent(set.name)}`;
    
    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.products || !Array.isArray(data.products)) {
      return 0; // No products found
    }

    // Filter and process cards
    const matchingCards = data.products.filter((product: any) => {
      const productName = product['product-name']?.toLowerCase() || '';
      const setNameLower = set.name.toLowerCase();
      
      // Enhanced matching logic
      if (productName.includes(setNameLower)) return true;
      
      // Word matching
      const setWords = setNameLower.split(' ').filter(w => w.length > 2);
      const matchedWords = setWords.filter(word => productName.includes(word));
      
      return matchedWords.length >= Math.min(3, Math.ceil(setWords.length * 0.6));
    });

    // Add new cards
    let cardsAdded = 0;
    for (const product of matchingCards) {
      const cardName = product['product-name'];
      if (!cardName || existingCardNames.has(cardName.toLowerCase())) {
        continue; // Skip if card already exists
      }

      try {
        await db.insert(cards).values({
          name: cardName,
          setId: set.id,
          cardNumber: '', // Will be populated later
          image: null,
          priceChartingId: product.id,
          loosePrice: product['loose-price'] || 0,
          cibPrice: product['cib-price'] || 0,
          newPrice: product['new-price'] || 0,
          variation: null,
          rarity: null,
          type: null,
          year: null,
          description: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        cardsAdded++;
      } catch (error) {
        console.error(`Failed to insert card "${cardName}":`, error);
        // Continue with next card
      }
    }

    return cardsAdded;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stopImport(): void {
    this.progress.isRunning = false;
    this.saveProgress();
    console.log('Import stopped by user');
  }
}

export const reliableImporter = new ReliableBackgroundImporter();
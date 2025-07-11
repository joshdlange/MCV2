import { db } from './db';
import { cardSets, cards } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, readFileSync, existsSync } from 'fs';

interface PriceChartingProduct {
  'product-name': string;
  'console-name': string;
  'loose-price': number;
  'cib-price': number;
  'new-price': number;
  id: string;
}

interface PriceChartingResponse {
  status: string;
  products: PriceChartingProduct[];
}

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

class PriceChartingImporter {
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
  private importInterval: NodeJS.Timeout | null = null;
  private readonly progressFile = 'pricecharting-import-progress.json';

  constructor() {
    this.apiToken = process.env.PRICECHARTING_API_TOKEN || '';
    if (!this.apiToken) {
      throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
    }
    this.loadProgress();
  }

  private loadProgress(): void {
    try {
      if (existsSync(this.progressFile)) {
        const saved = JSON.parse(readFileSync(this.progressFile, 'utf8'));
        this.progress = { ...this.progress, ...saved };
        console.log(`Loaded progress: ${this.progress.totalCardsAdded} cards added, ${this.progress.currentSetIndex}/${this.progress.totalSets} sets processed`);
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
    if (this.progress.isRunning) {
      throw new Error('Import is already running');
    }

    console.log('Starting continuous PriceCharting import...');
    this.progress.isRunning = true;
    this.progress.errors = [];
    this.progress.lastUpdated = new Date().toISOString();

    try {
      // Load all sets
      const allSets = await db.select().from(cardSets);
      this.progress.totalSets = allSets.length;

      // Start processing from current index
      this.processNextSet(allSets);
    } catch (error) {
      console.error('Failed to start import:', error);
      this.progress.isRunning = false;
      this.progress.errors.push(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processNextSet(allSets: any[]): Promise<void> {
    if (!this.progress.isRunning || this.progress.currentSetIndex >= allSets.length) {
      if (this.progress.currentSetIndex >= allSets.length) {
        console.log('🎉 Import completed successfully!');
        console.log(`Final totals: ${this.progress.totalCardsAdded} cards added, ${this.progress.totalSetsProcessed} sets processed`);
      }
      this.progress.isRunning = false;
      return;
    }

    const set = allSets[this.progress.currentSetIndex];
    this.progress.currentSetName = set.name;
    this.progress.lastUpdated = new Date().toISOString();

    try {
      console.log(`[${this.progress.currentSetIndex + 1}/${allSets.length}] Processing: "${set.name}"`);

      // Get existing cards for this set
      const existingCards = await db.select().from(cards).where(eq(cards.setId, set.id));
      const existingCardNames = new Set(existingCards.map(card => card.name.toLowerCase()));

      // Search PriceCharting for this set
      const searchUrl = `https://www.pricecharting.com/api/products?t=${this.apiToken}&q=${encodeURIComponent(set.name)}`;
      const response = await fetch(searchUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for set "${set.name}"`);
      }

      const data: PriceChartingResponse = await response.json();
      if (data.status !== 'success') {
        throw new Error(`API ${data.status} for set "${set.name}"`);
      }

      // Filter matching cards
      const matchingCards = data.products.filter(product => {
        if (!this.isTradingCard(product)) return false;
        const matchingSet = this.findMatchingSet(product, [set]);
        return matchingSet !== null;
      });

      console.log(`Found ${matchingCards.length} matching cards for "${set.name}"`);

      // Add new cards
      let newCardsForSet = 0;
      for (const card of matchingCards) {
        const productName = card['product-name'];
        
        if (existingCardNames.has(productName.toLowerCase())) {
          continue; // Skip existing cards
        }

        const cardNumber = this.extractCardNumber(productName);
        const estimatedValue = card['loose-price'] || card['cib-price'] || card['new-price'] || 0;

        await db.insert(cards).values({
          setId: set.id,
          name: productName,
          cardNumber,
          frontImageUrl: '',
          backImageUrl: '',
          variation: '',
          rarity: 'Unknown',
          description: '',
          estimatedValue
        });

        newCardsForSet++;
      }

      console.log(`✅ Added ${newCardsForSet} new cards to "${set.name}"`);
      this.progress.totalCardsAdded += newCardsForSet;
      this.progress.totalSetsProcessed++;
      this.saveProgress();

    } catch (error) {
      const errorMsg = `Error processing set "${set.name}": ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMsg);
      this.progress.errors.push(errorMsg);
      
      // Keep only last 10 errors
      if (this.progress.errors.length > 10) {
        this.progress.errors = this.progress.errors.slice(-10);
      }
    }

    // Move to next set
    this.progress.currentSetIndex++;
    this.progress.lastUpdated = new Date().toISOString();
    this.saveProgress();

    // Schedule next processing with delay
    setTimeout(() => this.processNextSet(allSets), 2000); // 2 second delay between sets
  }

  stopImport(): void {
    if (this.importInterval) {
      clearInterval(this.importInterval);
      this.importInterval = null;
    }
    this.progress.isRunning = false;
    this.progress.lastUpdated = new Date().toISOString();
    console.log('Import stopped by user');
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private getEditDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[j][i] = matrix[j - 1][i - 1];
        } else {
          matrix[j][i] = Math.min(
            matrix[j - 1][i - 1] + 1,
            matrix[j][i - 1] + 1,
            matrix[j - 1][i] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  private cleanSetName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractCardNumber(productName: string): string {
    const patterns = [
      /#(\d+)/,
      /No\.\s*(\d+)/i,
      /Card\s*(\d+)/i,
      /\b(\d+)\b/
    ];
    
    for (const pattern of patterns) {
      const match = productName.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return '';
  }

  private isTradingCard(product: PriceChartingProduct): boolean {
    const consoleName = product['console-name']?.toLowerCase() || '';
    const productName = product['product-name']?.toLowerCase() || '';
    
    const tradingCardIndicators = [
      'trading card',
      'card',
      'marvel',
      'x-men',
      'spider-man',
      'fantastic four',
      'avengers',
      'wolverine',
      'deadpool',
      'hulk',
      'iron man',
      'captain america',
      'thor'
    ];
    
    const excludePatterns = [
      'playstation',
      'xbox',
      'nintendo',
      'pc',
      'game',
      'video',
      'dvd',
      'blu-ray',
      'figure',
      'toy',
      'funko'
    ];
    
    const hasCardIndicator = tradingCardIndicators.some(indicator => 
      consoleName.includes(indicator) || productName.includes(indicator)
    );
    
    const hasExcludePattern = excludePatterns.some(pattern =>
      consoleName.includes(pattern) || productName.includes(pattern)
    );
    
    return hasCardIndicator && !hasExcludePattern;
  }

  private findMatchingSet(product: PriceChartingProduct, sets: any[]): any | null {
    const consoleName = product['console-name']?.toLowerCase() || '';
    
    for (const set of sets) {
      const setNameLower = set.name.toLowerCase();
      const cleanedConsole = this.cleanSetName(consoleName);
      const cleanedSet = this.cleanSetName(setNameLower);
      
      // Strategy 1: Direct similarity match (85% threshold)
      const directSimilarity = this.calculateSimilarity(cleanedConsole, cleanedSet);
      if (directSimilarity >= 0.85) {
        return set;
      }
      
      // Strategy 2: Word-based matching (60% of words must match)
      const setWords = cleanedSet.split(' ').filter(word => word.length > 2);
      const consoleWords = cleanedConsole.split(' ');
      const matchingWords = setWords.filter(word => consoleWords.includes(word));
      const wordMatchRatio = matchingWords.length / setWords.length;
      
      if (wordMatchRatio >= 0.6) {
        return set;
      }
    }
    
    return null;
  }
}

// Global instance
export const priceChartingImporter = new PriceChartingImporter();

// Auto-start if not complete
setTimeout(async () => {
  try {
    const progress = priceChartingImporter.getProgress();
    if (progress.totalSets === 0 || progress.currentSetIndex < progress.totalSets) {
      console.log('Auto-starting PriceCharting import...');
      await priceChartingImporter.startImport();
    }
  } catch (error) {
    console.error('Failed to auto-start import:', error);
  }
}, 3000); // Wait 3 seconds for server to be ready
import { db } from './db';
import { cards, cardSets } from '../shared/schema';
import { eq, sql, and, like, isNull, isNotNull } from 'drizzle-orm';

interface SetGroup {
  parentName: string;
  year: number;
  sets: Array<{
    id: number;
    name: string;
    subsetName: string;
    totalCards: number;
  }>;
}

interface ConsolidationResult {
  groupsProcessed: number;
  parentSetsCreated: number;
  cardsUpdated: number;
  setsConsolidated: number;
  consolidationReport: Array<{
    parentSet: string;
    consolidatedSets: string[];
    cardsAffected: number;
  }>;
}

export class CardSetConsolidationMigration {
  
  /**
   * Detect and group card sets that should be consolidated
   */
  private async detectSetGroups(): Promise<SetGroup[]> {
    console.log('🔍 Analyzing card sets for consolidation opportunities...');
    
    // Get all card sets
    const allSets = await db
      .select({
        id: cardSets.id,
        name: cardSets.name,
        year: cardSets.year,
        totalCards: cardSets.totalCards
      })
      .from(cardSets)
      .orderBy(cardSets.name, cardSets.year);

    console.log(`📊 Found ${allSets.length} total card sets`);

    // Group sets by potential parent names
    const setGroups = new Map<string, SetGroup>();

    for (const set of allSets) {
      const parentName = this.extractParentName(set.name);
      const subsetName = this.extractSubsetName(set.name, parentName);
      
      // Only group sets that have subset variations (not standalone sets)
      if (subsetName) {
        const groupKey = `${parentName}_${set.year}`;
        
        if (!setGroups.has(groupKey)) {
          setGroups.set(groupKey, {
            parentName,
            year: set.year,
            sets: []
          });
        }
        
        setGroups.get(groupKey)!.sets.push({
          id: set.id,
          name: set.name,
          subsetName,
          totalCards: set.totalCards
        });
      }
    }

    // Filter groups that have multiple sets to consolidate
    const consolidationGroups = Array.from(setGroups.values())
      .filter(group => group.sets.length > 1);

    console.log(`🎯 Identified ${consolidationGroups.length} groups for consolidation`);
    
    return consolidationGroups;
  }

  /**
   * Extract parent set name from full set name
   */
  private extractParentName(fullName: string): string {
    const name = fullName.toLowerCase().trim();
    
    // Common subset patterns to remove
    const subsetPatterns = [
      // Foil variations
      /\s+[-–]\s*(gold|silver|bronze|platinum|copper|rainbow|holographic|chrome)\s+(foil|parallel|variant|card)s?$/,
      /\s+(gold|silver|bronze|platinum|copper|rainbow|holographic|chrome)\s+(foil|parallel|variant|card)s?$/,
      
      // Precious metals and gems
      /\s+(blue|gold|green|red|purple|orange|pink|black|white)\s+precious\s+metal\s+gems?$/,
      /\s+precious\s+metal\s+gems?$/,
      
      // FX variations
      /\s+(gold|silver|bronze|copper|blue|green|red|purple|orange|pink|black|white)\s+fx$/,
      /\s+fx$/,
      
      // Special editions
      /\s+[-–]\s*(limited|special|exclusive|premium|deluxe|ultimate|signature)\s+(edition|series|collection)$/,
      /\s+(limited|special|exclusive|premium|deluxe|ultimate|signature)\s+(edition|series|collection)$/,
      
      // Specific Marvel patterns
      /\s+[-–]\s*(sp|autograph|auto|relic|patch|jersey|memorabilia)$/,
      /\s+(sp|autograph|auto|relic|patch|jersey|memorabilia)$/,
      /\s+printing\s+plate$/,
      /\s+grandiose$/,
      /\s+rave$/,
      /\s+(mighty|super|gold)\s+rave$/,
      /\s+a\s+force\s+rave$/,
      /\s+a\s+soldier's\s+metal$/,
      /\s+arc\s+weld$/,
      /\s+blast\s+furnace$/,
      /\s+comic\s+cuts$/,
      /\s+geodes?$/,
      /\s+intimidation\s+nation$/,
      /\s+metal\s+x$/,
      /\s+metalheads?$/,
      /\s+palladium$/,
      /\s+(emerald|gold)\s+palladium$/,
      /\s+planet\s+metal\s+iron\s+armor$/,
      /\s+(copper|gold|platinum)\s+planet\s+metal\s+iron\s+armor$/,
      /\s+purely\s+periodic$/,
      /\s+metalloid$/,
      
      // Generic numbered variations
      /\s+[-–]\s*(series|set|wave|part)\s+\d+$/,
      /\s+(series|set|wave|part)\s+\d+$/,
      
      // Year specific variations
      /\s+[-–]\s*\d{4}\s+(update|series|edition)$/,
      /\s+\d{4}\s+(update|series|edition)$/
    ];

    let parentName = name;
    
    // Apply patterns to extract parent name
    for (const pattern of subsetPatterns) {
      parentName = parentName.replace(pattern, '');
    }
    
    // Clean up any trailing dashes or spaces
    parentName = parentName.replace(/\s*[-–]\s*$/, '').trim();
    
    // Convert back to title case
    return this.toTitleCase(parentName);
  }

  /**
   * Extract subset name from full set name
   */
  private extractSubsetName(fullName: string, parentName: string): string | null {
    const name = fullName.toLowerCase().trim();
    const parent = parentName.toLowerCase().trim();
    
    if (name === parent) {
      return null; // No subset
    }
    
    // Extract the subset part
    let subsetName = name.replace(parent, '').trim();
    
    // Remove leading dashes or separators
    subsetName = subsetName.replace(/^[-–]\s*/, '').trim();
    
    if (subsetName === '') {
      return null;
    }
    
    return this.toTitleCase(subsetName);
  }

  /**
   * Convert string to title case
   */
  private toTitleCase(str: string): string {
    return str.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  /**
   * Create or find parent set
   */
  private async createOrFindParentSet(parentName: string, year: number, subsets: any[]): Promise<number> {
    // Check if parent set already exists
    const existingParent = await db
      .select({ id: cardSets.id })
      .from(cardSets)
      .where(and(
        eq(cardSets.name, parentName),
        eq(cardSets.year, year)
      ));

    if (existingParent.length > 0) {
      return existingParent[0].id;
    }

    // If no exact parent exists, find the subset with the most cards to become the parent
    // or the one that matches the parent name most closely (base set)
    let baseSet = subsets.find(s => s.name.toLowerCase() === parentName.toLowerCase());
    
    if (!baseSet) {
      // Find subset with most cards to promote to parent
      let maxCards = 0;
      for (const subset of subsets) {
        const cardCount = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(cards)
          .where(eq(cards.setId, subset.id));
        
        if (cardCount[0].count > maxCards) {
          maxCards = cardCount[0].count;
          baseSet = subset;
        }
      }
    }

    if (baseSet) {
      // Update the base set to become the parent
      await db
        .update(cardSets)
        .set({
          name: parentName,
          description: `Consolidated set containing all variations of ${parentName}`
        })
        .where(eq(cardSets.id, baseSet.id));
      
      console.log(`✅ Promoted existing set to parent: ${parentName} (${year})`);
      return baseSet.id;
    }

    // Create new parent set as fallback
    const newParent = await db
      .insert(cardSets)
      .values({
        name: parentName,
        year: year,
        description: `Consolidated set containing all variations of ${parentName}`,
        totalCards: 0, // Will be updated after migration
        imageUrl: null,
        createdAt: new Date()
      })
      .returning({ id: cardSets.id });

    console.log(`✅ Created new parent set: ${parentName} (${year})`);
    return newParent[0].id;
  }

  /**
   * Migrate cards from subset to parent set
   */
  private async migrateCards(fromSetId: number, toSetId: number, subsetName: string): Promise<number> {
    const result = await db
      .update(cards)
      .set({
        setId: toSetId,
        subsetName: subsetName
      })
      .where(eq(cards.setId, fromSetId))
      .returning({ id: cards.id });

    return result.length;
  }

  /**
   * Update total cards count for parent set
   */
  private async updateParentSetCardCount(parentSetId: number): Promise<void> {
    const cardCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(cards)
      .where(eq(cards.setId, parentSetId));

    await db
      .update(cardSets)
      .set({
        totalCards: cardCount[0].count
      })
      .where(eq(cardSets.id, parentSetId));
  }

  /**
   * Run the complete consolidation migration
   */
  async runConsolidation(): Promise<ConsolidationResult> {
    console.log('🚀 Starting card set consolidation migration...');
    
    const result: ConsolidationResult = {
      groupsProcessed: 0,
      parentSetsCreated: 0,
      cardsUpdated: 0,
      setsConsolidated: 0,
      consolidationReport: []
    };

    try {
      // Detect groups to consolidate
      const setGroups = await this.detectSetGroups();
      
      if (setGroups.length === 0) {
        console.log('ℹ️ No consolidation opportunities found');
        return result;
      }

      result.groupsProcessed = setGroups.length;

      // Process each group
      for (const group of setGroups) {
        console.log(`\n📦 Processing group: ${group.parentName} (${group.year})`);
        console.log(`   Sets to consolidate: ${group.sets.length}`);

        // Create or find parent set
        const parentSetId = await this.createOrFindParentSet(group.parentName, group.year, group.sets);
        
        // Check if this is a newly created parent set
        const isNewParent = await this.isNewlyCreatedParent(parentSetId, group.sets);
        if (isNewParent) {
          result.parentSetsCreated++;
        }

        let groupCardsUpdated = 0;
        const consolidatedSetNames: string[] = [];

        // Migrate cards from each subset to parent
        for (const subset of group.sets) {
          // Check actual card count, not just the totalCards field which may be outdated
          const actualCardCount = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(cards)
            .where(eq(cards.setId, subset.id));

          const actualCount = actualCardCount[0].count;
          
          if (actualCount > 0) {
            console.log(`   Migrating ${actualCount} cards from: ${subset.name}`);
            
            const cardsMigrated = await this.migrateCards(
              subset.id,
              parentSetId,
              subset.subsetName
            );

            groupCardsUpdated += cardsMigrated;
            consolidatedSetNames.push(subset.name);
            result.setsConsolidated++;
          } else {
            console.log(`   Skipping ${subset.name} (no cards)`);
          }
        }

        // Update parent set card count
        await this.updateParentSetCardCount(parentSetId);

        result.cardsUpdated += groupCardsUpdated;
        
        result.consolidationReport.push({
          parentSet: `${group.parentName} (${group.year})`,
          consolidatedSets: consolidatedSetNames,
          cardsAffected: groupCardsUpdated
        });

        console.log(`   ✅ Consolidated ${groupCardsUpdated} cards into parent set`);
      }

      console.log('\n🎉 Consolidation migration completed successfully!');
      this.printConsolidationSummary(result);

      return result;

    } catch (error) {
      console.error('❌ Consolidation migration failed:', error);
      throw error;
    }
  }

  /**
   * Check if parent set was newly created (no cards before migration)
   */
  private async isNewlyCreatedParent(parentSetId: number, subsets: any[]): Promise<boolean> {
    // If any subset has the same ID as parent, it's not newly created
    return !subsets.some(subset => subset.id === parentSetId);
  }

  /**
   * Print consolidation summary
   */
  private printConsolidationSummary(result: ConsolidationResult): void {
    console.log('\n📋 CONSOLIDATION SUMMARY');
    console.log('========================');
    console.log(`Groups processed: ${result.groupsProcessed}`);
    console.log(`Parent sets created: ${result.parentSetsCreated}`);
    console.log(`Sets consolidated: ${result.setsConsolidated}`);
    console.log(`Cards updated: ${result.cardsUpdated}`);
    
    console.log('\n📊 DETAILED REPORT');
    console.log('==================');
    
    for (const report of result.consolidationReport) {
      console.log(`\n🎯 ${report.parentSet}`);
      console.log(`   Cards affected: ${report.cardsAffected}`);
      console.log(`   Sets consolidated:`);
      for (const setName of report.consolidatedSets) {
        console.log(`     - ${setName}`);
      }
    }
  }

  /**
   * Validate consolidation results
   */
  async validateConsolidation(): Promise<void> {
    console.log('\n🔍 Validating consolidation results...');
    
    // Check for cards without subset names that should have them
    const cardsWithoutSubset = await db
      .select({
        count: sql<number>`COUNT(*)`
      })
      .from(cards)
      .where(isNull(cards.subsetName));

    console.log(`Cards without subset names: ${cardsWithoutSubset[0].count}`);

    // Check parent sets card counts
    const parentSetsWithCards = await db
      .select({
        id: cardSets.id,
        name: cardSets.name,
        totalCards: cardSets.totalCards,
        actualCount: sql<number>`(SELECT COUNT(*) FROM ${cards} WHERE ${cards.setId} = ${cardSets.id})`
      })
      .from(cardSets)
      .where(sql`${cardSets.totalCards} > 0`);

    let mismatchCount = 0;
    for (const set of parentSetsWithCards) {
      if (set.totalCards !== set.actualCount) {
        console.log(`⚠️ Card count mismatch: ${set.name} (expected: ${set.totalCards}, actual: ${set.actualCount})`);
        mismatchCount++;
      }
    }

    if (mismatchCount === 0) {
      console.log('✅ All parent sets have correct card counts');
    }

    console.log('✅ Validation completed');
  }
}

// Export migration runner function
export async function runCardSetConsolidation(): Promise<ConsolidationResult> {
  const migration = new CardSetConsolidationMigration();
  const result = await migration.runConsolidation();
  await migration.validateConsolidation();
  return result;
}
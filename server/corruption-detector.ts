/**
 * Data Corruption Detection and Prevention System
 * Prevents character encoding issues and data corruption
 */

import { db } from './db';
import { cards } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

interface CorruptionResult {
  found: boolean;
  corruptedCards: Array<{
    id: number;
    name: string;
    correctedName?: string;
  }>;
  fixed: number;
}

/**
 * Detect and fix character corruption in card names
 */
export async function detectAndFixCorruption(): Promise<CorruptionResult> {
  console.log('🔍 Scanning for data corruption...');
  
  try {
    // Find cards with common corruption patterns
    const corruptedCards = await db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber
      })
      .from(cards)
      .where(
        sql`name LIKE '%���%' OR name LIKE '%�%' OR name LIKE '%8tn%' OR name LIKE '%8th%' OR name LIKE '%8nd%' OR name LIKE '%8rd%'`
      );

    console.log(`Found ${corruptedCards.length} potentially corrupted cards`);

    if (corruptedCards.length === 0) {
      return { found: false, corruptedCards: [], fixed: 0 };
    }

    let fixedCount = 0;
    const results: Array<{
      id: number;
      name: string;
      correctedName?: string;
    }> = [];

    // Apply known fixes
    for (const card of corruptedCards) {
      let correctedName = card.name;
      let wasFixed = false;

      // Fix common corruption patterns
      if (card.name.includes('Mai ���keth')) {
        correctedName = 'Malekith';
        wasFixed = true;
      } else if (card.name.includes('���')) {
        // Try to infer the correct name by removing corruption markers
        correctedName = card.name.replace(/���/g, '...');
        wasFixed = true;
      } else if (card.name.includes('8tn')) {
        // This might be "8th" corrupted
        correctedName = card.name.replace(/8tn/g, '8th');
        wasFixed = true;
      }

      if (wasFixed) {
        await db
          .update(cards)
          .set({ name: correctedName })
          .where(eq(cards.id, card.id));
        
        fixedCount++;
        console.log(`✅ Fixed: "${card.name}" → "${correctedName}"`);
      }

      results.push({
        id: card.id,
        name: card.name,
        correctedName: wasFixed ? correctedName : undefined
      });
    }

    console.log(`🔧 Fixed ${fixedCount} corrupted cards`);
    
    return {
      found: true,
      corruptedCards: results,
      fixed: fixedCount
    };

  } catch (error) {
    console.error('❌ Error during corruption detection:', error);
    return { found: false, corruptedCards: [], fixed: 0 };
  }
}

/**
 * Validate text before database insertion to prevent corruption
 */
export function validateAndSanitizeText(text: string): string {
  if (!text) return text;

  // Remove or replace problematic characters
  let sanitized = text
    .replace(/���/g, '...') // Replace common corruption with ellipsis
    .replace(/[^\x20-\x7E\u00A0-\u024F\u2018\u2019\u201C\u201D]/g, '') // Keep printable ASCII + Latin + quotes
    .trim();

  // Log potential issues
  if (sanitized !== text) {
    console.warn(`⚠️ Text sanitized: "${text}" → "${sanitized}"`);
  }

  return sanitized;
}

/**
 * Regular corruption monitoring (can be called periodically)
 */
export async function runCorruptionMonitoring(): Promise<void> {
  console.log('🔍 Running scheduled corruption monitoring...');
  
  const result = await detectAndFixCorruption();
  
  if (result.found) {
    console.log(`🚨 Corruption detected! Fixed ${result.fixed} cards automatically.`);
  } else {
    console.log('✅ No corruption detected in database.');
  }
}
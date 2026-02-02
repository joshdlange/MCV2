import { db } from '../server/db';
import { cards, cardSets } from '../shared/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const PLACEHOLDER_URL = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

async function runBulkImageImport() {
  const csvPath = path.join(process.cwd(), 'public/uploads/card_images_import.csv');
  
  console.log('[BULK IMAGE IMPORT] Reading CSV file...');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  
  const parseResult = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true
  });
  
  const rows = parseResult.data as any[];
  console.log(`[BULK IMAGE IMPORT] Parsed ${rows.length} total rows`);
  
  const rowsWithImages = rows.filter(row => {
    const url = row['image_url']?.trim();
    return url && url.startsWith('http');
  });
  
  console.log(`[BULK IMAGE IMPORT] Found ${rowsWithImages.length} rows with image URLs`);
  
  if (rowsWithImages.length === 0) {
    console.log('No rows with image URLs found');
    return;
  }
  
  console.log(`[BULK IMAGE IMPORT] Building set name lookup cache...`);
  const allSets = await db.select({ id: cardSets.id, name: cardSets.name }).from(cardSets).where(eq(cardSets.isActive, true));
  const setCache: Map<string, number> = new Map();
  for (const set of allSets) {
    const normalizedName = set.name.toLowerCase().trim().replace(/\s+/g, ' ');
    setCache.set(normalizedName, set.id);
  }
  console.log(`[BULK IMAGE IMPORT] Cached ${setCache.size} active sets`);
  
  let successCount = 0;
  let notFoundCount = 0;
  let alreadyHasImageCount = 0;
  const BATCH_SIZE = 100;
  
  console.log(`[BULK IMAGE IMPORT] Processing ${rowsWithImages.length} cards with images...`);
  
  for (let i = 0; i < rowsWithImages.length; i++) {
    const row = rowsWithImages[i];
    try {
      const fullCombo = row['FULL COMBO']?.trim();
      const cardNumber = row['Card Number']?.toString().trim();
      const imageUrl = row['image_url']?.trim();
      
      if (!fullCombo || !cardNumber || !imageUrl) {
        continue;
      }
      
      const normalizedCombo = fullCombo.toLowerCase().trim().replace(/\s+/g, ' ');
      const setId = setCache.get(normalizedCombo);
      
      if (!setId) {
        notFoundCount++;
        continue;
      }
      
      const result = await db.update(cards)
        .set({ frontImageUrl: imageUrl })
        .where(and(
          eq(cards.setId, setId),
          eq(cards.cardNumber, cardNumber),
          or(
            isNull(cards.frontImageUrl),
            eq(cards.frontImageUrl, PLACEHOLDER_URL)
          )
        ));
      
      if ((result as any).rowCount > 0) {
        successCount++;
      } else {
        const exists = await db.select({ id: cards.id }).from(cards)
          .where(and(eq(cards.setId, setId), eq(cards.cardNumber, cardNumber)))
          .limit(1);
        if (exists.length > 0) {
          alreadyHasImageCount++;
        } else {
          notFoundCount++;
        }
      }
    } catch (e: any) {
      console.error(`Error row ${i}: ${e.message}`);
    }
    
    if ((i + 1) % 1000 === 0) {
      console.log(`[BULK IMAGE IMPORT] Progress: ${i + 1}/${rowsWithImages.length} - Updated: ${successCount}, Not found: ${notFoundCount}, Already has image: ${alreadyHasImageCount}`);
    }
  }
  
  console.log(`\n[BULK IMAGE IMPORT] COMPLETE`);
  console.log(`Updated: ${successCount}`);
  console.log(`Not found: ${notFoundCount}`);
  console.log(`Already has image: ${alreadyHasImageCount}`);
  
  process.exit(0);
}

runBulkImageImport().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

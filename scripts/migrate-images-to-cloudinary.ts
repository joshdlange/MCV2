import { v2 as cloudinary } from 'cloudinary';
import { db } from '../server/db';
import { cards, mainSets } from '../shared/schema';
import { eq, like, and, not, isNotNull, sql } from 'drizzle-orm';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BATCH_SIZE = 50;
const DELAY_BETWEEN_BATCHES_MS = 2000;

async function downloadAndUploadCardImage(
  externalUrl: string,
  cardId: number
): Promise<string | null> {
  try {
    if (externalUrl.includes('res.cloudinary.com')) {
      return externalUrl;
    }

    const response = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      console.error(`[MIGRATE] Card ${cardId}: HTTP ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      console.error(`[MIGRATE] Card ${cardId}: Invalid content type ${contentType}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 10 * 1024 * 1024) {
      console.error(`[MIGRATE] Card ${cardId}: Image too large`);
      return null;
    }

    const result = await cloudinary.uploader.upload(
      `data:${contentType};base64,${buffer.toString('base64')}`,
      {
        folder: 'marvel-cards',
        public_id: `card_${cardId}_${Date.now()}`,
        resource_type: 'image',
        transformation: [
          { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
          { format: 'auto' }
        ]
      }
    );

    return result.secure_url;
  } catch (error: any) {
    console.error(`[MIGRATE] Card ${cardId}: ${error.message}`);
    return null;
  }
}

async function downloadAndUploadMainSetImage(
  externalUrl: string,
  mainSetId: number
): Promise<string | null> {
  try {
    if (externalUrl.includes('res.cloudinary.com')) {
      return externalUrl;
    }

    const response = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      console.error(`[MIGRATE] Main set ${mainSetId}: HTTP ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      console.error(`[MIGRATE] Main set ${mainSetId}: Invalid content type ${contentType}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 10 * 1024 * 1024) {
      console.error(`[MIGRATE] Main set ${mainSetId}: Image too large`);
      return null;
    }

    const result = await cloudinary.uploader.upload(
      `data:${contentType};base64,${buffer.toString('base64')}`,
      {
        folder: 'main-set-thumbnails',
        public_id: `main_set_${mainSetId}_${Date.now()}`,
        resource_type: 'image',
        transformation: [
          { width: 400, height: 400, crop: 'fit', quality: 'auto' },
          { format: 'auto' }
        ]
      }
    );

    return result.secure_url;
  } catch (error: any) {
    console.error(`[MIGRATE] Main set ${mainSetId}: ${error.message}`);
    return null;
  }
}

async function migrateCardImages() {
  console.log('[MIGRATE] Starting card image migration from comc.com to Cloudinary...');
  
  const cardsToMigrate = await db.select({ id: cards.id, frontImageUrl: cards.frontImageUrl })
    .from(cards)
    .where(like(cards.frontImageUrl, '%comc.com%'));
  
  console.log(`[MIGRATE] Found ${cardsToMigrate.length} cards with comc.com images`);
  
  let migrated = 0;
  let failed = 0;
  
  for (let i = 0; i < cardsToMigrate.length; i += BATCH_SIZE) {
    const batch = cardsToMigrate.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(async (card) => {
        const newUrl = await downloadAndUploadCardImage(card.frontImageUrl!, card.id);
        if (newUrl && newUrl !== card.frontImageUrl) {
          await db.update(cards)
            .set({ frontImageUrl: newUrl })
            .where(eq(cards.id, card.id));
          return { success: true, cardId: card.id };
        }
        return { success: false, cardId: card.id };
      })
    );
    
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.success) {
        migrated++;
      } else {
        failed++;
      }
    });
    
    console.log(`[MIGRATE] Progress: ${i + batch.length}/${cardsToMigrate.length} - Migrated: ${migrated}, Failed: ${failed}`);
    
    if (i + BATCH_SIZE < cardsToMigrate.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }
  
  console.log(`[MIGRATE] Card migration complete: ${migrated} migrated, ${failed} failed`);
  return { migrated, failed };
}

async function migrateMainSetImages() {
  console.log('[MIGRATE] Starting main set thumbnail migration to Cloudinary...');
  
  const mainSetsToMigrate = await db.select({ id: mainSets.id, thumbnailImageUrl: mainSets.thumbnailImageUrl })
    .from(mainSets)
    .where(
      and(
        isNotNull(mainSets.thumbnailImageUrl),
        not(like(mainSets.thumbnailImageUrl, '%cloudinary%')),
        not(eq(mainSets.thumbnailImageUrl, ''))
      )
    );
  
  console.log(`[MIGRATE] Found ${mainSetsToMigrate.length} main sets with external images`);
  
  let migrated = 0;
  let failed = 0;
  
  for (const mainSet of mainSetsToMigrate) {
    const newUrl = await downloadAndUploadMainSetImage(mainSet.thumbnailImageUrl!, mainSet.id);
    if (newUrl && newUrl !== mainSet.thumbnailImageUrl) {
      await db.update(mainSets)
        .set({ thumbnailImageUrl: newUrl })
        .where(eq(mainSets.id, mainSet.id));
      migrated++;
      console.log(`[MIGRATE] Main set ${mainSet.id}: Migrated successfully`);
    } else {
      failed++;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`[MIGRATE] Main set migration complete: ${migrated} migrated, ${failed} failed`);
  return { migrated, failed };
}

async function main() {
  console.log('[MIGRATE] ========================================');
  console.log('[MIGRATE] Image Migration to Cloudinary');
  console.log('[MIGRATE] ========================================');
  
  const startTime = Date.now();
  
  // First migrate main set images (smaller set)
  const mainSetResults = await migrateMainSetImages();
  
  // Then migrate card images
  const cardResults = await migrateCardImages();
  
  const duration = Math.round((Date.now() - startTime) / 1000 / 60);
  
  console.log('[MIGRATE] ========================================');
  console.log('[MIGRATE] MIGRATION COMPLETE');
  console.log(`[MIGRATE] Main sets: ${mainSetResults.migrated} migrated, ${mainSetResults.failed} failed`);
  console.log(`[MIGRATE] Cards: ${cardResults.migrated} migrated, ${cardResults.failed} failed`);
  console.log(`[MIGRATE] Total time: ${duration} minutes`);
  console.log('[MIGRATE] ========================================');
  
  process.exit(0);
}

main().catch(err => {
  console.error('[MIGRATE] Fatal error:', err);
  process.exit(1);
});

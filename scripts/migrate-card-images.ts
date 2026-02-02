import { v2 as cloudinary } from 'cloudinary';
import { db } from '../server/db';
import { cards } from '../shared/schema';
import { eq, like, sql } from 'drizzle-orm';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BATCH_SIZE = 100;

async function downloadAndUpload(url: string, cardId: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > 10 * 1024 * 1024) return null;

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
  } catch (error) {
    return null;
  }
}

async function main() {
  const startArg = process.argv[2] ? parseInt(process.argv[2]) : 0;
  const limitArg = process.argv[3] ? parseInt(process.argv[3]) : 500;
  
  console.log(`[MIGRATE] Starting from offset ${startArg}, processing ${limitArg} cards...`);
  
  const cardsToMigrate = await db.select({ id: cards.id, frontImageUrl: cards.frontImageUrl })
    .from(cards)
    .where(like(cards.frontImageUrl, '%comc.com%'))
    .limit(limitArg)
    .offset(startArg);
  
  console.log(`[MIGRATE] Got ${cardsToMigrate.length} cards to process`);
  
  if (cardsToMigrate.length === 0) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(like(cards.frontImageUrl, '%comc.com%'));
    console.log(`[MIGRATE] No more cards at offset ${startArg}. Total remaining: ${count}`);
    process.exit(0);
  }
  
  let migrated = 0;
  let failed = 0;
  
  for (let i = 0; i < cardsToMigrate.length; i++) {
    const card = cardsToMigrate[i];
    const newUrl = await downloadAndUpload(card.frontImageUrl!, card.id);
    if (newUrl) {
      await db.update(cards)
        .set({ frontImageUrl: newUrl })
        .where(eq(cards.id, card.id));
      migrated++;
    } else {
      failed++;
    }
    
    if ((i + 1) % 50 === 0 || i === cardsToMigrate.length - 1) {
      console.log(`[MIGRATE] ${i + 1}/${cardsToMigrate.length} - OK: ${migrated}, Fail: ${failed}`);
    }
  }
  
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(cards)
    .where(like(cards.frontImageUrl, '%comc.com%'));
  
  console.log(`[MIGRATE] Batch done: ${migrated} migrated, ${failed} failed. Total remaining: ${count}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[MIGRATE] Fatal:', err);
  process.exit(1);
});

#!/usr/bin/env tsx

import { drizzle } from 'drizzle-orm/neon-serverless';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function monitorProgress() {
  try {
    console.log('🏪 COMC Image Population Progress Monitor');
    console.log('=======================================');
    
    const [totalCards] = await db.execute(`
      SELECT COUNT(*) as total 
      FROM cards
    `);
    
    const [cardsWithImages] = await db.execute(`
      SELECT COUNT(*) as with_images 
      FROM cards 
      WHERE front_image_url IS NOT NULL AND front_image_url != ''
    `);
    
    const [cardsWithoutImages] = await db.execute(`
      SELECT COUNT(*) as without_images 
      FROM cards 
      WHERE front_image_url IS NULL OR front_image_url = ''
    `);
    
    const total = totalCards.rows[0].total;
    const withImages = cardsWithImages.rows[0].with_images;
    const withoutImages = cardsWithoutImages.rows[0].without_images;
    const completionRate = ((withImages / total) * 100).toFixed(1);
    
    console.log(`📊 Total Cards: ${total.toLocaleString()}`);
    console.log(`✅ With Images: ${withImages.toLocaleString()}`);
    console.log(`📭 Missing Images: ${withoutImages.toLocaleString()}`);
    console.log(`📈 Completion Rate: ${completionRate}%`);
    
    // Show recent activity (cards updated in last hour)
    const [recentUpdates] = await db.execute(`
      SELECT COUNT(*) as recent_updates 
      FROM cards 
      WHERE front_image_url IS NOT NULL 
      AND front_image_url != ''
      AND front_image_url LIKE '%cloudinary%'
      AND updated_at > NOW() - INTERVAL '1 hour'
    `);
    
    const recentCount = recentUpdates.rows[0].recent_updates;
    console.log(`🕒 Recent Updates (last hour): ${recentCount.toLocaleString()}`);
    
    // Estimate time to completion at current rate
    if (recentCount > 0) {
      const hoursToCompletion = Math.ceil(withoutImages / recentCount);
      console.log(`⏰ Est. time to completion: ${hoursToCompletion} hours`);
    }
    
    console.log('\n🔄 Monitoring every 60 seconds...');
    
  } catch (error) {
    console.error('❌ Error monitoring progress:', error);
  }
}

// Monitor progress every minute
setInterval(monitorProgress, 60000);
monitorProgress(); // Run immediately
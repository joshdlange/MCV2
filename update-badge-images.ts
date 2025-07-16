import { db } from './server/db';
import { badges } from './shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

const badgeMapping = {
  // Collection badges
  'Rookie.png': 'Rookie Collector',
  'hundredclub.png': 'Hundred Club',
  'Vaultguardian.png': 'Vault Guardian',
  'inserthunter.png': 'Insert Hunter',
  'Setcompletor.png': 'Set Completer',
  'Master Collector.png': 'Master Collector',
  
  // Social badges
  'chatterbox.png': 'Chatterbox',
  'Friendly face.png': 'Friendly Face',
  'squad assembled.png': 'Squad Assembled',
  'Social butterfly.png': 'Social Butterfly',
  'mentor.png': 'Mentor',
  
  // Achievement badges
  'night owl.png': 'Night Owl',
  '7 day streak.png': '7-Day Streak',
  'curator.png': 'Curator',
  'Speed Collector.png': 'Speed Collector',
  'historian.png': 'Historian',
  
  // Event badges
  'beta tester.png': 'Beta Tester',
  'early riser.png': 'Early Bird',
  'Spiderman day.png': 'Spidey Fan',
  'launch day.png': 'Launch Day Hero',
  'event.png': 'Event Winner'
};

async function updateBadgeImages() {
  console.log('🎯 Starting badge image update...');
  
  const sourceDir = 'badge_images/New Folder With Items';
  const targetDir = 'uploads/badges';
  
  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const [filename, badgeName] of Object.entries(badgeMapping)) {
    try {
      const sourcePath = path.join(sourceDir, filename);
      const targetPath = path.join(targetDir, filename.toLowerCase().replace(/\s+/g, '-'));
      
      // Check if source file exists
      if (!fs.existsSync(sourcePath)) {
        console.error(`❌ Source file not found: ${sourcePath}`);
        errorCount++;
        continue;
      }
      
      // Copy file to uploads directory
      fs.copyFileSync(sourcePath, targetPath);
      
      // Update database with new image URL
      const result = await db
        .update(badges)
        .set({ 
          iconUrl: `/uploads/badges/${filename.toLowerCase().replace(/\s+/g, '-')}` 
        })
        .where(eq(badges.name, badgeName))
        .returning();
      
      if (result.length > 0) {
        console.log(`✅ Updated ${badgeName} with image ${filename}`);
        successCount++;
      } else {
        console.error(`❌ Badge not found in database: ${badgeName}`);
        errorCount++;
      }
      
    } catch (error) {
      console.error(`❌ Error updating ${badgeName}:`, error);
      errorCount++;
    }
  }
  
  console.log(`\n🎉 Badge image update complete!`);
  console.log(`✅ Successfully updated: ${successCount} badges`);
  console.log(`❌ Errors: ${errorCount} badges`);
  
  // Show current badge status
  const allBadges = await db.select().from(badges).orderBy(badges.category, badges.name);
  console.log('\n📊 Current badge status:');
  allBadges.forEach(badge => {
    const status = badge.iconUrl ? '🖼️' : '🔳';
    console.log(`${status} ${badge.name} (${badge.category})`);
  });
}

// Run the update
updateBadgeImages().catch(console.error);
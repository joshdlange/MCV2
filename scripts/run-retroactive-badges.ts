import { storage } from '../server/storage.js';

async function runRetroactiveBadges() {
  console.log('🎯 Running retroactive badge system for all users...');
  
  try {
    // Get all users
    const users = await storage.getAllUsers();
    console.log(`Found ${users.length} users to check for badges...`);
    
    let totalBadgesAwarded = 0;
    
    for (const user of users) {
      try {
        console.log(`\nChecking badges for user: ${user.displayName || user.username}`);
        
        // Check and award badges for this user
        const newBadges = await storage.checkAndAwardBadges(user.id);
        
        if (newBadges.length > 0) {
          console.log(`✅ Awarded ${newBadges.length} badges to ${user.displayName || user.username}:`);
          newBadges.forEach(badge => {
            if (badge.badge && badge.badge.name) {
              console.log(`  - ${badge.badge.name}: ${badge.badge.description}`);
            }
          });
          totalBadgesAwarded += newBadges.length;
        } else {
          console.log(`⚪ No new badges for ${user.displayName || user.username}`);
        }
      } catch (error) {
        console.error(`❌ Error checking badges for user ${user.id}:`, error);
      }
    }
    
    console.log(`\n🎉 Retroactive badge system complete!`);
    console.log(`📊 Total badges awarded: ${totalBadgesAwarded}`);
    
  } catch (error) {
    console.error('❌ Error in retroactive badge system:', error);
  }
}

runRetroactiveBadges();
#!/usr/bin/env tsx
import { bulkUpdateMissingImages, checkBulkUpdateConfiguration } from '../server/bulk-image-updater';

/**
 * Standalone script to update missing card images
 * Usage: npm run update-missing-images [limit]
 */
async function main() {
  console.log('🖼️ Marvel Card Vault - Bulk Image Update Script');
  console.log('===============================================\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const limit = args[0] ? parseInt(args[0]) : undefined;
  
  if (limit && isNaN(limit)) {
    console.error('❌ Invalid limit value. Please provide a number.');
    process.exit(1);
  }
  
  console.log(`📊 Configuration:`);
  console.log(`   - Limit: ${limit || 'No limit (all cards)'}`);
  console.log(`   - Rate limit: ${process.env.EBAY_RATE_LIMIT_MS || 3000}ms between requests`);
  
  // Check configuration
  const config = checkBulkUpdateConfiguration();
  if (!config.ready) {
    console.error('❌ Configuration Error:');
    console.error('   Missing required environment variables:');
    config.missingConfig.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease add these to your .env file or environment variables.');
    process.exit(1);
  }
  
  console.log('✅ Configuration check passed');
  console.log('🚀 Starting bulk image update...\n');
  
  try {
    const result = await bulkUpdateMissingImages({
      limit,
      rateLimitMs: config.rateLimitMs,
      onProgress: (progress) => {
        const percent = Math.round((progress.current / progress.total) * 100);
        const statusEmoji = {
          processing: '⏳',
          success: '✅',
          failure: '❌',
          skipped: '⏭️'
        }[progress.status];
        
        console.log(`${statusEmoji} [${percent}%] ${progress.current}/${progress.total} - Card ${progress.cardId}: ${progress.cardName}`);
        if (progress.message) {
          console.log(`   ${progress.message}`);
        }
      }
    });
    
    console.log('\n🎉 BULK UPDATE COMPLETED!');
    console.log('=============================');
    console.log(`📊 Total processed: ${result.totalProcessed}`);
    console.log(`✅ Successful: ${result.successCount}`);
    console.log(`❌ Failed: ${result.failureCount}`);
    console.log(`⏭️ Skipped: ${result.skippedCount}`);
    
    if (result.failures.length > 0) {
      console.log('\n❌ FAILED CARDS (for manual review):');
      result.failures.forEach(failure => {
        console.log(`   - Card ${failure.cardId} (${failure.setName} - ${failure.cardName}): ${failure.error}`);
      });
    }
    
    const successRate = result.totalProcessed > 0 ? 
      Math.round((result.successCount / result.totalProcessed) * 100) : 0;
    
    console.log(`\n📈 Success rate: ${successRate}%`);
    
    if (result.successCount > 0) {
      console.log('✅ Image updates successful! Your card collection now has more images.');
    }
    
  } catch (error) {
    console.error('\n🚨 CRITICAL ERROR:');
    console.error(error);
    process.exit(1);
  }
}

// Handle script termination gracefully
process.on('SIGINT', () => {
  console.log('\n⏹️ Script interrupted by user. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️ Script terminated. Exiting...');
  process.exit(0);
});

// Run the script
main().catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
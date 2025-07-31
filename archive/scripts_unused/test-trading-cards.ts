#!/usr/bin/env tsx

async function testTradingCards() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🧪 Testing PriceCharting API for trading cards...');
  
  try {
    // Test different search queries to find trading cards
    const searches = [
      'marvel trading cards',
      'marvel card',
      'trading card',
      'card game',
      'marvel x-men',
      'marvel spider-man'
    ];
    
    for (const query of searches) {
      console.log(`\n📡 Searching for: "${query}"`);
      
      const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
        continue;
      }
      
      const data = await response.json();
      
      // Filter for trading cards
      const tradingCards = data.products?.filter((product: any) => {
        const consoleName = product['console-name']?.toLowerCase() || '';
        const productName = product['product-name']?.toLowerCase() || '';
        
        return consoleName.includes('trading') || 
               consoleName.includes('card') ||
               productName.includes('trading') ||
               productName.includes('card');
      }) || [];
      
      console.log(`✅ Total products: ${data.products?.length || 0}`);
      console.log(`🎯 Trading cards found: ${tradingCards.length}`);
      
      if (tradingCards.length > 0) {
        console.log('🔍 Trading card samples:');
        tradingCards.slice(0, 3).forEach((card: any, index: number) => {
          console.log(`${index + 1}. ${card['product-name']}`);
          console.log(`   Console: ${card['console-name']}`);
          console.log(`   Price: ${card['loose-price']}`);
          console.log('');
        });
      }
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testTradingCards();
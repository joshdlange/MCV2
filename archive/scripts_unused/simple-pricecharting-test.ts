#!/usr/bin/env tsx

async function testAPI() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🧪 Testing PriceCharting API...');
  
  try {
    // Test basic products endpoint
    const url = `https://www.pricecharting.com/api/products?t=${apiToken}&q=marvel`;
    console.log(`📡 Fetching: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
      process.exit(1);
    }
    
    const data = await response.json();
    
    console.log('✅ API Status:', data.status);
    console.log('📊 Products found:', data.products?.length || 0);
    
    if (data.products && data.products.length > 0) {
      console.log('\n🔍 First 3 products:');
      data.products.slice(0, 3).forEach((product: any, index: number) => {
        console.log(`${index + 1}. ${product['product-name']}`);
        console.log(`   Console: ${product['console-name']}`);
        console.log(`   Price: ${product['loose-price']}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testAPI();
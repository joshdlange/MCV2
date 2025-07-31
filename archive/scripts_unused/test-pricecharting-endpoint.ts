#!/usr/bin/env tsx
// Test script to verify PriceCharting API endpoint and data structure

async function testPriceChartingEndpoint() {
  const apiToken = process.env.PRICECHARTING_API_TOKEN;
  
  if (!apiToken) {
    console.error('❌ PRICECHARTING_API_TOKEN environment variable is required');
    process.exit(1);
  }
  
  console.log('🧪 Testing PriceCharting API endpoint...');
  
  try {
    // Test multiple approaches to find trading cards
    const testUrls = [
      `https://www.pricecharting.com/api/products?t=${apiToken}&platform=trading-card&prettyprint`,
      `https://www.pricecharting.com/api/products?t=${apiToken}&q=marvel&prettyprint`,
      `https://www.pricecharting.com/api/products?t=${apiToken}&q=trading+card&prettyprint`,
      `https://www.pricecharting.com/api/products?t=${apiToken}&prettyprint`
    ];
    
    for (const url of testUrls) {
      console.log(`\n📡 Testing: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
        continue;
      }
      
      const data = await response.json();
      
      console.log('✅ API Response Status:', data.status);
      console.log('📊 Products found:', data.products?.length || 0);
      
      if (data.products && data.products.length > 0) {
      console.log('\n🔍 Sample products:');
      
      // Show first 5 products
      data.products.slice(0, 5).forEach((product: any, index: number) => {
        console.log(`\n${index + 1}. Product ID: ${product.id}`);
        console.log(`   Name: ${product['product-name']}`);
        console.log(`   Console: ${product['console-name']}`);
        console.log(`   Loose Price: ${product['loose-price']}`);
        console.log(`   CIB Price: ${product['cib-price']}`);
        console.log(`   New Price: ${product['new-price']}`);
        console.log(`   Image: ${product.image || 'None'}`);
        
        // Test parsing
        const parseResult = parseCardName(product['product-name']);
        if (parseResult) {
          console.log(`   Parsed → Set: "${parseResult.setName}", Card: "${parseResult.cardName}", Number: "${parseResult.cardNumber}"`);
        }
      });
      
      // Filter for Marvel-related cards
      const marvelCards = data.products.filter((product: any) => {
        const name = product['product-name']?.toLowerCase() || '';
        return name.includes('marvel') || name.includes('spider-man') || name.includes('x-men') || name.includes('wolverine');
      });
      
      console.log(`\n🎯 Marvel-related cards found: ${marvelCards.length}`);
      if (marvelCards.length > 0) {
        console.log('Marvel cards sample:');
        marvelCards.slice(0, 3).forEach((card: any, index: number) => {
          console.log(`${index + 1}. ${card['product-name']}`);
        });
      }
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } catch (error) {
    console.error('❌ Error testing API:', error);
    process.exit(1);
  }
}

// Simple card name parsing function (copy from main script)
function parseCardName(productName: string): { setName: string; cardNumber: string; cardName: string } | null {
  const originalName = productName.trim();
  
  // Look for #NN or NN near the end of the string
  const numberPattern = /#(\d+)|(\d+)(?=\s+[\w\s]+$)/;
  const match = originalName.match(numberPattern);
  
  if (match) {
    const cardNumber = match[1] || match[2];
    const numberIndex = match.index!;
    
    // Everything before the number is the setName
    const setName = originalName.substring(0, numberIndex).trim();
    
    // Everything after the number is the cardName
    const afterNumber = originalName.substring(numberIndex + match[0].length).trim();
    const cardName = afterNumber || 'Unknown';
    
    return {
      setName,
      cardNumber,
      cardName
    };
  } else {
    // No number found - use "0" as card number and full name as cardName
    return {
      setName: originalName,
      cardNumber: '0',
      cardName: originalName
    };
  }
}

// Run the test
testPriceChartingEndpoint();
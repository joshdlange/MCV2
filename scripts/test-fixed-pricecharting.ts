import { db } from '../server/db';
import { cardSets } from '../shared/schema';

interface PriceChartingProduct {
  id: string;
  'product-name': string;
  'console-name': string;
  'loose-price'?: number;
  'cib-price'?: number;
  'new-price'?: number;
  image?: string;
}

interface PriceChartingResponse {
  products: PriceChartingProduct[];
}

async function testFixedPriceCharting() {
  console.log('=== TESTING FIXED PRICECHARTING FORMAT ===');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Test with a few specific sets
  const testSets = [
    "Marvel 2025 Topps Chrome",
    "Marvel 2024 Upper Deck",
    "Marvel 2023 Fleer Ultra"
  ];

  // Format set name for PriceCharting API (convert to lowercase with dashes)
  const formatSetName = (name: string) => {
    return name.toLowerCase().replace(/\s+/g, '-');
  };

  for (const setName of testSets) {
    console.log(`\n==================== TESTING: "${setName}" ====================`);
    
    const formattedName = formatSetName(setName);
    console.log(`Formatted query: "${formattedName}"`);
    
    try {
      const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=${formattedName}&t=${apiKey}`);
      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      console.log(`Found ${products.length} products`);
      
      if (products.length > 0) {
        console.log(`\nSample products found:`);
        products.slice(0, 5).forEach((product, index) => {
          console.log(`  ${index + 1}. "${product['product-name']}" (${product['console-name']})`);
        });
      } else {
        console.log(`❌ No products found for "${formattedName}"`);
      }
      
    } catch (error) {
      console.error(`Error testing "${setName}":`, error);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n=== TEST COMPLETED ===');
}

testFixedPriceCharting().catch(console.error);
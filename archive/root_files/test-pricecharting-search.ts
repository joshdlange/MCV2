import { db } from './server/db';

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

async function testPriceChartingSearch() {
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  // Test different search queries for the What If set
  const queries = [
    'marvel 2020 masterpieces What If...',
    'marvel 2020 masterpieces what if',
    'marvel masterpieces what if',
    '2020 masterpieces what if',
    'marvel what if masterpieces'
  ];

  for (const query of queries) {
    console.log(`\n=== Testing query: "${query}" ===`);
    
    const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(query)}&t=${apiKey}`;
    console.log(`API Call: ${apiUrl.replace(apiKey, 'HIDDEN_KEY')}`);
    
    try {
      const response = await fetch(apiUrl);
      const data: PriceChartingResponse = await response.json();
      const products = data.products || [];
      
      console.log(`Found: ${products.length} products`);
      
      // Count unique card numbers
      const cardNumbers = new Set();
      products.forEach(product => {
        const match = product['product-name'].match(/^(.+?)\s+#([A-Z0-9-]+)$/);
        if (match) {
          cardNumbers.add(match[2]);
        }
      });
      
      console.log(`Unique card numbers: ${cardNumbers.size}`);
      
      // Show first 5 products
      console.log('First 5 products:');
      products.slice(0, 5).forEach((product, index) => {
        console.log(`  ${index + 1}. "${product['product-name']}" (Console: ${product['console-name']})`);
      });
      
    } catch (error) {
      console.error(`Error: ${error}`);
    }
  }

  // Also test a broader search
  console.log(`\n=== Testing broader search ===`);
  const broadQuery = 'marvel masterpieces 2020';
  const apiUrl = `https://www.pricecharting.com/api/products?platform=trading-card&q=${encodeURIComponent(broadQuery)}&t=${apiKey}`;
  console.log(`API Call: ${apiUrl.replace(apiKey, 'HIDDEN_KEY')}`);
  
  try {
    const response = await fetch(apiUrl);
    const data: PriceChartingResponse = await response.json();
    const products = data.products || [];
    
    console.log(`Found: ${products.length} products`);
    
    // Filter for What If cards
    const whatIfCards = products.filter(p => 
      p['product-name'].toLowerCase().includes('what if') ||
      p['console-name'].toLowerCase().includes('what if')
    );
    
    console.log(`What If cards found: ${whatIfCards.length}`);
    
    // Show first 10 What If cards
    console.log('First 10 What If cards:');
    whatIfCards.slice(0, 10).forEach((product, index) => {
      console.log(`  ${index + 1}. "${product['product-name']}" (Console: ${product['console-name']})`);
    });
    
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}

testPriceChartingSearch().catch(console.error);
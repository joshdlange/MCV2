#!/usr/bin/env tsx
// Simple test script to understand PriceCharting API response format

async function testPriceChartingAPI() {
  const token = process.env.PRICECHARTING_API_TOKEN;
  
  if (!token) {
    console.log('No PRICECHARTING_API_TOKEN found');
    return;
  }
  
  console.log('Testing PriceCharting API...');
  
  // Test different endpoints
  const endpoints = [
    `https://www.pricecharting.com/api/products?t=${token}&q=marvel`,
    `https://www.pricecharting.com/api/products?t=${token}&q=spider-man`,
    `https://www.pricecharting.com/api/products?t=${token}&q=trading+card`,
    `https://www.pricecharting.com/api/products?t=${token}`,
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`\nTesting: ${endpoint}`);
      const response = await fetch(endpoint);
      
      if (!response.ok) {
        console.log(`❌ Status: ${response.status} ${response.statusText}`);
        continue;
      }
      
      const data = await response.json();
      console.log(`✅ Response:`, JSON.stringify(data, null, 2));
      
      if (data.products && data.products.length > 0) {
        console.log(`📋 Sample product:`, data.products[0]);
      }
      
    } catch (error) {
      console.log(`❌ Error:`, error);
    }
  }
}

testPriceChartingAPI();
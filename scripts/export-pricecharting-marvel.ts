import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

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

async function exportPriceChartingMarvelProducts() {
  console.log('Starting PriceCharting Marvel product export...');
  
  const apiKey = process.env.PRICECHARTING_API_TOKEN;
  if (!apiKey) {
    throw new Error('PRICECHARTING_API_TOKEN environment variable is required');
  }

  try {
    // Fetch Marvel trading card products from PriceCharting
    // Note: API might require a search query, so we'll search for "marvel" directly
    console.log('Fetching Marvel trading card products from PriceCharting...');
    const response = await fetch(`https://www.pricecharting.com/api/products?platform=trading-card&q=marvel&t=${apiKey}`);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data: PriceChartingResponse = await response.json();
    const allProducts = data.products || [];
    
    console.log(`Found ${allProducts.length} Marvel trading card products`);
    
    // Filter for actual trading cards (not video games, comics, or other items)
    const marvelProducts = allProducts.filter(product => {
      const productName = product['product-name']?.toLowerCase() || '';
      const consoleName = product['console-name']?.toLowerCase() || '';
      
      // Must contain Marvel-related terms
      const hasMarvelTerms = productName.includes('marvel') || consoleName.includes('marvel') || 
                            productName.includes('spider') || productName.includes('x-men') || 
                            productName.includes('avengers') || productName.includes('fantastic four');
      
      // Must be actual trading cards (exclude video games, comics, toys, etc.)
      const isNotVideoGame = !consoleName.includes('playstation') && 
                             !consoleName.includes('xbox') && 
                             !consoleName.includes('nintendo') && 
                             !consoleName.includes('sega') && 
                             !consoleName.includes('pc') &&
                             !consoleName.includes('switch');
      
      const isNotComicOrToy = !consoleName.includes('comic books') && 
                             !consoleName.includes('funko') && 
                             !consoleName.includes('toy biz');
      
      // Look for trading card indicators
      const isLikelyTradingCard = consoleName.includes('marvel') || 
                                 consoleName.includes('universe') || 
                                 consoleName.includes('masterpieces') || 
                                 consoleName.includes('fleer') || 
                                 consoleName.includes('topps') || 
                                 consoleName.includes('upper deck') || 
                                 consoleName.includes('skybox') || 
                                 productName.includes('#');
      
      return hasMarvelTerms && isNotVideoGame && isNotComicOrToy && isLikelyTradingCard;
    });
    
    console.log(`Filtered to ${marvelProducts.length} Marvel-related products`);
    
    if (marvelProducts.length === 0) {
      console.log('No Marvel products found. Exiting...');
      return;
    }
    
    // Prepare CSV data
    const csvRows = ['productId,name,imageUrl,price,platform'];
    
    marvelProducts.forEach(product => {
      const productId = product.id || '';
      const name = `"${(product['product-name'] || '').replace(/"/g, '""')}"`;
      const imageUrl = product.image || '';
      const price = product['loose-price'] || product['cib-price'] || product['new-price'] || 0;
      const platform = `"${(product['console-name'] || '').replace(/"/g, '""')}"`;
      
      csvRows.push(`${productId},${name},${imageUrl},${price},${platform}`);
    });
    
    // Create data directory if it doesn't exist
    const dataDir = 'data';
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, that's ok
    }
    
    // Write CSV file
    const csvFilePath = join(dataDir, 'pricecharting-marvel-products.csv');
    const csvContent = csvRows.join('\n');
    
    writeFileSync(csvFilePath, csvContent, 'utf8');
    
    console.log(`\n✅ Export completed successfully!`);
    console.log(`📁 File saved to: ${csvFilePath}`);
    console.log(`📊 Total Marvel products exported: ${marvelProducts.length}`);
    console.log(`💾 File size: ${Math.round(csvContent.length / 1024)} KB`);
    
    // Show sample of exported data
    console.log(`\n📋 Sample of exported products:`);
    marvelProducts.slice(0, 5).forEach((product, index) => {
      console.log(`${index + 1}. ${product['product-name']} (${product['console-name']})`);
    });
    
    if (marvelProducts.length > 5) {
      console.log(`... and ${marvelProducts.length - 5} more products`);
    }
    
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
}

// Run the export
exportPriceChartingMarvelProducts()
  .then(() => {
    console.log('\nExport process completed.');
  })
  .catch((error) => {
    console.error('Export process failed:', error);
    process.exit(1);
  });
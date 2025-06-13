import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import { storage } from './storage';
import fs from 'fs';
import path from 'path';

// Global API call counter for tracking calls per session
let ebayCallCount = 0;

// Path for persistent daily API call tracking
const apiCallLogPath = path.join(process.cwd(), 'api-call-log.json');

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Read daily API call log from file
 */
function readDailyCallLog(): Record<string, number> {
  try {
    if (fs.existsSync(apiCallLogPath)) {
      const data = fs.readFileSync(apiCallLogPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading API call log:', error);
  }
  return {};
}

/**
 * Write daily API call log to file
 */
function writeDailyCallLog(log: Record<string, number>): void {
  try {
    fs.writeFileSync(apiCallLogPath, JSON.stringify(log, null, 2));
  } catch (error) {
    console.error('Error writing API call log:', error);
  }
}

/**
 * Increment and track daily API call count
 */
function trackDailyApiCall(): void {
  const today = getTodayDate();
  const log = readDailyCallLog();
  
  // Initialize today's count if it doesn't exist
  if (!log[today]) {
    log[today] = 0;
  }
  
  // Increment count
  log[today]++;
  
  // Write back to file
  writeDailyCallLog(log);
  
  console.log(`Daily eBay API calls for ${today}: ${log[today]}`);
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface EBayImageResult {
  title: string;
  pictureURLSuperSize?: string;
  pictureURLLarge?: string;
  galleryURL?: string;
  itemId: string;
}

interface CardImageUpdate {
  cardId: number;
  setName: string;
  cardName: string;
  cardNumber: string;
  description?: string;
  originalImageUrl?: string;
  newImageUrl?: string;
  success: boolean;
  error?: string;
}

/**
 * Search for card images using multiple sources
 * Primary: eBay with ${setName} ${cardName} ${cardNumber} comc format
 * Fallback: COMC.com direct search when eBay fails
 */
async function searchEBayForCardImage(
  setName: string,
  cardName: string,
  cardNumber: string,
  description?: string
): Promise<string | null> {
  try {
    // Primary: eBay search with COMC format
    const searchTerms = `${setName} ${cardName} ${cardNumber} comc`.replace(/\s+/g, ' ').trim();
    console.log(`Primary search - eBay with COMC format: "${searchTerms}"`);

    const ebayResult = await performEBaySearch(searchTerms);
    if (ebayResult) {
      console.log(`✅ Found image using eBay COMC format search`);
      return ebayResult;
    }

    // Fallback: Direct COMC.com search
    console.log(`eBay failed, trying COMC.com direct search...`);
    const comcResult = await searchCOMCForCardImage(setName, cardName, cardNumber);
    if (comcResult) {
      console.log(`✅ Found image using COMC.com direct search`);
      return comcResult;
    }

    console.log(`❌ No images found from either eBay or COMC sources`);
    return null;

  } catch (error) {
    console.error('Image search error:', error);
    // For eBay API errors, try COMC fallback
    if (error instanceof Error && error.message.startsWith('EBAY_API_ERROR:')) {
      console.log(`eBay API error, trying COMC fallback...`);
      try {
        const comcResult = await searchCOMCForCardImage(setName, cardName, cardNumber);
        if (comcResult) {
          console.log(`✅ Fallback successful: Found image using COMC.com`);
          return comcResult;
        }
      } catch (fallbackError) {
        console.error('COMC fallback also failed:', fallbackError);
      }
    }
    throw error;
  }
}

/**
 * Search COMC.com for card images as fallback source
 */
async function searchCOMCForCardImage(
  setName: string,
  cardName: string,
  cardNumber: string
): Promise<string | null> {
  try {
    // Clean and format search terms for COMC
    const cleanSetName = setName.replace(/[^\w\s-]/g, '').trim();
    const cleanCardName = cardName.replace(/[^\w\s-]/g, '').trim();
    const cleanCardNumber = cardNumber.replace(/[^\w\s-]/g, '').trim();
    
    const searchQuery = `${cleanSetName} ${cleanCardName} ${cleanCardNumber}`.replace(/\s+/g, '+');
    const comcUrl = `https://www.comc.com/Cards/Trading_Card_Singles,sr,i100?sq=${encodeURIComponent(searchQuery)}`;
    
    console.log(`🔍 COMC search URL: ${comcUrl}`);
    
    const response = await fetch(comcUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });

    if (!response.ok) {
      console.log(`❌ COMC HTTP error: ${response.status}`);
      return null;
    }

    const html = await response.text();
    
    // Extract first card image from COMC HTML
    // Look for common COMC image patterns
    // Extract first card image from COMC HTML with improved patterns
    const imagePatterns = [
      // Primary CloudFront images
      /https:\/\/d2t1xqejof9utc\.cloudfront\.net\/pictures\/files\/[^"'\s]+\.jpg/g,
      // Alternative COMC image patterns
      /https:\/\/[^"'\s]*\.cloudfront\.net\/[^"'\s]+\.jpg/g,
      // Data-src patterns
      /data-src=["']([^"']*cloudfront[^"']*\.jpg)["']/g,
      // Src patterns
      /src=["']([^"']*cloudfront[^"']*\.jpg)["']/g,
      // Direct image URLs in various formats
      /["'](https:\/\/[^"'\s]*comc[^"'\s]*\.(jpg|jpeg|png))["']/g
    ];

    for (const pattern of imagePatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        let imageUrl = match[1] || match[0];
        
        // Clean up the URL
        imageUrl = imageUrl.replace(/^["']|["']$/g, '');
        imageUrl = imageUrl.replace(/data-src=|src=/g, '');
        
        if (imageUrl.startsWith('http') && (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg') || imageUrl.includes('.png'))) {
          console.log(`Found COMC image: ${imageUrl}`);
          return imageUrl;
        }
      }
    }

    console.log(`❌ No valid images found in COMC response`);
    return null;

  } catch (error) {
    console.error('COMC search error:', error);
    return null;
  }
}

async function performEBaySearch(searchTerms: string): Promise<string | null> {
  try {
    // Increment session and daily API call counters
    ebayCallCount++;
    trackDailyApiCall();
    
    // Get the App ID being used and log it for debugging
    const appId = process.env.EBAY_APP_ID_PROD || process.env.EBAY_APP_ID || '';
    console.log(`🔍 eBay API call #${ebayCallCount} — keywords: "${searchTerms}"`);
    console.log(`🔑 Using SECURITY-APPNAME: ${appId ? appId.substring(0, 20) + '...' : 'NOT SET'}`);
    
    const ebayApiUrl = 'https://svcs.ebay.com/services/search/FindingService/v1';
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findItemsByKeywords',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': appId,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': '',
      'keywords': searchTerms,
      'categoryId': '183454', // Sports Trading Cards category
      'sortOrder': 'BestMatch',
      'paginationInput.entriesPerPage': '15',
      'paginationInput.pageNumber': '1',
      'outputSelector(0)': 'PictureURLSuperSize',
      'outputSelector(1)': 'PictureURLLarge',
      'outputSelector(2)': 'GalleryInfo'
    });

    console.log(`📡 Full eBay API URL: ${ebayApiUrl}?${params}`);
    const response = await fetch(`${ebayApiUrl}?${params}`);
    
    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error(`❌ Failed to parse eBay API response: ${parseError}`);
      return null;
    }
    
    // Enhanced error logging for error code 10001 and others
    const ebayError = data?.errorMessage?.[0]?.error?.[0];
    if (ebayError) {
      console.error('🚨 eBay API error detected:');
      console.error('📋 Full error response:', JSON.stringify(data, null, 2));
      console.error(`🔑 SECURITY-APPNAME used: ${appId}`);
      console.error(`🆔 Error ID: ${ebayError.errorId?.[0]}`);
      console.error(`📝 Error Message: ${ebayError.message?.[0]}`);
      console.error(`🏷️ Error Domain: ${ebayError.domain?.[0]}`);
      console.error(`⚠️ Error Severity: ${ebayError.severity?.[0]}`);
      
      // Special handling for error 10001 (App ID rate limit/restriction)
      if (ebayError.errorId?.[0] === '10001') {
        console.error('🚫 eBay App ID rate limit/restriction detected (error 10001)');
        console.error('🔍 App ID may be restricted, expired, or using sandbox credentials');
        console.error('💡 Suggestion: Check eBay Developer Account for App ID status');
        // Don't throw error immediately - try alternative image sources
        return null;
      }
      
      throw new Error(`EBAY_API_ERROR: ${ebayError.errorId?.[0]} - ${ebayError.message?.[0]}`);
    }
    
    if (!response.ok) {
      console.error(`❌ eBay API HTTP error: ${response.status} ${response.statusText}`);
      console.error('📋 Response body:', JSON.stringify(data, null, 2));
      return null;
    }
    
    console.log(`✅ eBay API successful response for "${searchTerms}"`);
    
    // Only log full response in debug mode to reduce noise
    if (process.env.NODE_ENV === 'development') {
      console.log('📋 Full eBay response:', JSON.stringify(data, null, 2));
    }

    if (!data.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item) {
      console.log(`❌ No items found in eBay response for "${searchTerms}"`);
      return null;
    }

    const items = data.findItemsByKeywordsResponse[0].searchResult[0].item;
    console.log(`🔍 Found ${items.length} items, checking for high-quality images...`);
    
    // Find the first item with a high-quality image
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      console.log(`📷 Checking item ${i + 1}: "${item.title?.[0] || 'Unknown title'}"`);
      
      // Prefer pictureURLSuperSize
      if (item.pictureURLSuperSize?.[0]) {
        console.log(`✅ Found SUPER SIZE image for item ${i + 1}`);
        console.log(`🖼️ Image URL: ${item.pictureURLSuperSize[0]}`);
        return item.pictureURLSuperSize[0];
      }
      
      // Fallback to pictureURLLarge
      if (item.pictureURLLarge?.[0]) {
        console.log(`✅ Found LARGE image for item ${i + 1}`);
        console.log(`🖼️ Image URL: ${item.pictureURLLarge[0]}`);
        return item.pictureURLLarge[0];
      }
      
      // Final fallback to galleryURL
      if (item.galleryURL?.[0]) {
        console.log(`✅ Found GALLERY image for item ${i + 1}`);
        console.log(`🖼️ Image URL: ${item.galleryURL[0]}`);
        return item.galleryURL[0];
      }
      
      console.log(`❌ Item ${i + 1} has no usable images`);
    }

    console.log('❌ No quality images found in any eBay results');
    return null;

  } catch (error) {
    // Enhanced error logging
    console.error('🚨 eBay search error caught:', error);
    
    // Let EBAY_API_ERROR and RATE_LIMIT_EXCEEDED propagate up immediately
    if (error instanceof Error && (error.message === 'RATE_LIMIT_EXCEEDED' || error.message.startsWith('EBAY_API_ERROR:'))) {
      throw error;
    }
    return null;
  }
}

/**
 * Upload image to Cloudinary from URL
 */
async function uploadImageToCloudinary(imageUrl: string, cardId: number): Promise<string | null> {
  try {
    console.log(`☁️ Starting Cloudinary upload for card ${cardId}`);
    console.log(`📎 Source image URL: ${imageUrl}`);
    
    // Validate Cloudinary configuration
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      console.error('❌ Cloudinary configuration missing - check environment variables');
      return null;
    }
    
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'marvel-cards',
      public_id: `card_${cardId}_${Date.now()}`,
      transformation: [
        { width: 400, height: 560, crop: 'fit', quality: 'auto' },
        { format: 'webp' }
      ]
    });

    console.log(`✅ Successfully uploaded to Cloudinary for card ${cardId}`);
    console.log(`🔗 Cloudinary URL: ${result.secure_url}`);
    return result.secure_url;

  } catch (error) {
    console.error(`❌ Cloudinary upload failed for card ${cardId}:`, error);
    console.error(`📎 Failed image URL: ${imageUrl}`);
    return null;
  }
}

/**
 * Find and update a single card's image - ENHANCED WITH DETAILED LOGGING
 */
export async function findAndUpdateCardImage(
  cardId: number,
  setName: string,
  cardName: string,
  cardNumber: string,
  description?: string
): Promise<CardImageUpdate> {
  const result: CardImageUpdate = {
    cardId,
    setName,
    cardName,
    cardNumber,
    description,
    success: false
  };

  console.log(`🎯 Starting image find and update for card ${cardId}`);
  console.log(`📋 Card details: Set="${setName}", Name="${cardName}", Number="${cardNumber}"`);
  console.log(`📝 Description: ${description || 'None'}`);

  try {
    // Step 1: Search eBay for image
    console.log(`📡 Step 1: Searching eBay for card image...`);
    const ebayImageUrl = await searchEBayForCardImage(setName, cardName, cardNumber, description);
    
    if (!ebayImageUrl) {
      console.log(`❌ Step 1 FAILED: No image found from any source`);
      result.error = 'No image found from eBay or COMC sources';
      return result;
    }

    console.log(`✅ Step 1 SUCCESS: Found eBay image`);
    result.originalImageUrl = ebayImageUrl;

    // Step 2: Upload to Cloudinary
    console.log(`☁️ Step 2: Uploading image to Cloudinary...`);
    const cloudinaryUrl = await uploadImageToCloudinary(ebayImageUrl, cardId);
    
    if (!cloudinaryUrl) {
      console.log(`❌ Step 2 FAILED: Cloudinary upload failed`);
      result.error = 'Image found on eBay but failed to upload to Cloudinary';
      return result;
    }

    console.log(`✅ Step 2 SUCCESS: Image uploaded to Cloudinary`);
    result.newImageUrl = cloudinaryUrl;

    // Step 3: Update database
    console.log(`💾 Step 3: Updating database with new image URL...`);
    await storage.updateCard(cardId, {
      name: cardName,
      setId: 0, // Will be ignored in update
      cardNumber,
      rarity: '', // Will be ignored in update
      frontImageUrl: cloudinaryUrl
    });

    console.log(`✅ Step 3 SUCCESS: Database updated`);
    result.success = true;
    console.log(`🎉 COMPLETE SUCCESS: Card ${cardId} updated with new image`);
    
    return result;

  } catch (error) {
    console.log(`🚨 ERROR during image update process for card ${cardId}`);
    
    if (error instanceof Error) {
      if (error.message === 'RATE_LIMIT_EXCEEDED') {
        result.error = 'eBay API daily rate limit exceeded (10,000 requests/day). Please try again tomorrow.';
        console.error(`🚫 eBay API rate limit exceeded for card ${cardId}`);
      } else if (error.message.startsWith('EBAY_API_ERROR:')) {
        result.error = error.message.replace('EBAY_API_ERROR: ', 'eBay API Error: ');
        console.error(`🚨 eBay API error for card ${cardId}: ${error.message}`);
      } else {
        result.error = `Unexpected error: ${error.message}`;
        console.error(`❌ Unexpected error updating card ${cardId}:`, error);
      }
    } else {
      result.error = `Unknown error: ${error}`;
      console.error(`❓ Unknown error updating card ${cardId}:`, error);
    }
    return result;
  }
}

/**
 * Batch process multiple cards to find and update images
 * Includes rate limiting to respect eBay API limits
 */
export async function batchUpdateCardImages(maxCards: number = 50): Promise<CardImageUpdate[]> {
  console.log(`Starting batch image update for up to ${maxCards} cards`);
  
  const results: CardImageUpdate[] = [];
  
  try {
    // Get cards with missing images
    const cardsWithoutImages = await storage.getCardsWithoutImages(maxCards);
    
    if (cardsWithoutImages.length === 0) {
      console.log('No cards found missing images');
      return results;
    }

    console.log(`Found ${cardsWithoutImages.length} cards missing images`);

    // Process each card with rate limiting
    for (let i = 0; i < cardsWithoutImages.length; i++) {
      const card = cardsWithoutImages[i];
      
      console.log(`Processing card ${i + 1}/${cardsWithoutImages.length}: ${card.name}`);
      
      try {
        const result = await findAndUpdateCardImage(
          card.id,
          card.set.name || '',
          card.name,
          card.cardNumber,
          card.description || undefined
        );
        
        results.push(result);
        
        // If we hit rate limit, stop processing and return what we have
        if (result.error?.includes('rate limit exceeded')) {
          console.log('Rate limit exceeded, stopping batch processing');
          break;
        }
        
      } catch (error) {
        if (error instanceof Error && error.message === 'RATE_LIMIT_EXCEEDED') {
          console.log('Rate limit exceeded, stopping batch processing');
          results.push({
            cardId: card.id,
            setName: card.set.name || '',
            cardName: card.name,
            cardNumber: card.cardNumber,
            description: card.description || undefined,
            success: false,
            error: 'eBay API daily rate limit exceeded (10,000 requests/day). Please try again tomorrow.'
          });
          break;
        }
        throw error;
      }
      
      // Dynamic rate limiting: configurable wait time between requests
      if (i < cardsWithoutImages.length - 1) {
        const waitMs = parseInt(process.env.EBAY_RATE_LIMIT_MS || '1000', 10);
        console.log(`Waiting ${waitMs}ms before next request...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const rateLimitCount = results.filter(r => r.error?.includes('rate limit')).length;
    console.log(`Batch update complete: ${successCount}/${results.length} cards updated successfully${rateLimitCount > 0 ? `, ${rateLimitCount} stopped due to rate limit` : ''}`);
    
    // Log total API calls made during this batch run
    console.log(`Total eBay API calls made this run: ${ebayCallCount}`);
    
    return results;

  } catch (error) {
    console.error('Batch update error:', error);
    return results;
  }
}

/**
 * Check eBay and Cloudinary configuration
 */
export function checkConfiguration(): void {
  console.log('🔧 Checking eBay and Cloudinary configuration...');
  
  // Check eBay configuration
  const ebayAppId = process.env.EBAY_APP_ID_PROD || process.env.EBAY_APP_ID || '';
  console.log(`🔑 eBay App ID configured: ${ebayAppId ? 'YES' : 'NO'}`);
  if (ebayAppId) {
    console.log(`🔑 eBay App ID (first 20 chars): ${ebayAppId.substring(0, 20)}...`);
    console.log(`🔑 eBay App ID length: ${ebayAppId.length} characters`);
  }
  
  // Check Cloudinary configuration
  const cloudinaryName = process.env.CLOUDINARY_CLOUD_NAME || '';
  const cloudinaryKey = process.env.CLOUDINARY_API_KEY || '';
  const cloudinarySecret = process.env.CLOUDINARY_API_SECRET || '';
  
  console.log(`☁️ Cloudinary Cloud Name: ${cloudinaryName ? 'YES' : 'NO'}`);
  console.log(`☁️ Cloudinary API Key: ${cloudinaryKey ? 'YES' : 'NO'}`);
  console.log(`☁️ Cloudinary API Secret: ${cloudinarySecret ? 'YES' : 'NO'}`);
  
  if (cloudinaryName) {
    console.log(`☁️ Cloudinary Cloud Name: ${cloudinaryName}`);
  }
}

/**
 * Test eBay integration with a single card - SIMPLIFIED
 */
export async function testSingleCard(): Promise<CardImageUpdate> {
  console.log('🧪 Testing eBay integration with single test card...');
  
  // Check configuration first
  checkConfiguration();
  
  const testCard = {
    id: 999999, // Test ID that won't conflict with real cards
    setName: 'Marvel 2024 skybox masterpieces xl',
    cardName: 'Multiple Man',
    cardNumber: '10'
  };

  console.log(`🧪 Test card: ${testCard.setName} ${testCard.cardName} ${testCard.cardNumber}`);
  
  const result = await findAndUpdateCardImage(
    testCard.id,
    testCard.setName,
    testCard.cardName,
    testCard.cardNumber
  );

  console.log('🧪 Test complete. Result:', result);
  return result;
}
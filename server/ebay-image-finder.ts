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
 * Search COMC.com for card images using exact format: ${setName} ${cardName} ${cardNumber}
 */
async function searchCOMCForCardImage(
  setName: string,
  cardName: string,
  cardNumber: string
): Promise<string | null> {
  try {
    // Use EXACT format as specified: setName cardName cardNumber
    const searchTerms = `${setName} ${cardName} ${cardNumber}`.replace(/\s+/g, ' ').trim();
    console.log(`🔍 COMC search with exact format: "${searchTerms}"`);
    
    return await attemptCOMCSearch(searchTerms);
  } catch (error) {
    console.error('COMC search error:', error);
    return null;
  }
}

async function attemptCOMCSearch(searchTerms: string): Promise<string | null> {
  // Try multiple trading card sites for image discovery
  const sites = [
    {
      name: 'CardboardConnection',
      baseUrl: 'https://www.cardboardconnection.com/',
      searchUrl: (query: string) => `https://www.google.com/search?q=site:cardboardconnection.com+${encodeURIComponent(query)}+card+image`,
      imagePattern: /https:\/\/[^"'\s<>]*cardboardconnection[^"'\s<>]*\.(jpg|jpeg|png)/gi
    },
    {
      name: 'TradingCardDB',
      baseUrl: 'https://www.tradingcarddb.com/',
      searchUrl: (query: string) => `https://www.google.com/search?q=site:tradingcarddb.com+${encodeURIComponent(query)}`,
      imagePattern: /https:\/\/[^"'\s<>]*tradingcarddb[^"'\s<>]*\.(jpg|jpeg|png)/gi
    },
    {
      name: 'PSA Card Facts',
      baseUrl: 'https://www.psacard.com/',
      searchUrl: (query: string) => `https://www.google.com/search?q=site:psacard.com+${encodeURIComponent(query)}+card`,
      imagePattern: /https:\/\/[^"'\s<>]*psacard[^"'\s<>]*\.(jpg|jpeg|png)/gi
    }
  ];

  const cleanTerms = searchTerms.replace(/[^\w\s-]/g, ' ').trim();
  
  for (const site of sites) {
    try {
      console.log(`🔍 Searching ${site.name} for: ${cleanTerms}`);
      
      const searchUrl = site.searchUrl(cleanTerms);
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!response.ok) continue;

      const html = await response.text();
      
      // Extract image URLs using site-specific patterns AND eBay images from Google results
      const allImagePatterns = [
        site.imagePattern,
        /https:\/\/i\.ebayimg\.com\/images\/[^"'\s<>]+\.(jpg|jpeg|png)/gi,
        /https:\/\/[^"'\s<>]*ebay[^"'\s<>]*\.(jpg|jpeg|png)/gi
      ];
      
      for (const pattern of allImagePatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          const imageUrl = match[0];
          if (imageUrl && imageUrl.length > 30 && 
              !imageUrl.includes('logo') && 
              !imageUrl.includes('icon') && 
              !imageUrl.includes('avatar') &&
              !imageUrl.includes('thumb-950') && // Skip box images
              (imageUrl.includes('card') || imageUrl.includes('image') || imageUrl.includes('ebayimg'))) {
            console.log(`✅ Found image from ${site.name}: ${imageUrl}`);
            return imageUrl;
          }
        }
      }
      
      // Generic image pattern as backup
      const genericPattern = /https:\/\/[^"'\s<>]*\.(jpg|jpeg|png)/gi;
      const genericMatches = [];
      let genericMatch;
      while ((genericMatch = genericPattern.exec(html)) !== null && genericMatches.length < 10) {
        const imageUrl = genericMatch[0];
        if (imageUrl.includes(site.baseUrl.replace('https://', '').replace('www.', '')) &&
            !imageUrl.includes('logo') &&
            !imageUrl.includes('icon') &&
            imageUrl.length > 40) {
          genericMatches.push(imageUrl);
        }
      }
      
      if (genericMatches.length > 0) {
        console.log(`✅ Found generic image from ${site.name}: ${genericMatches[0]}`);
        return genericMatches[0];
      }
      
    } catch (error) {
      console.log(`❌ Error searching ${site.name}:`, error);
      continue;
    }
  }

  return null;
}

async function attemptGoogleImagesSearch(
  setName: string,
  cardName: string,
  cardNumber: string
): Promise<string | null> {
  try {
    // Create a focused search query for Google Images
    const query = `"${setName}" "${cardName}" card ${cardNumber}`.replace(/\s+/g, '+');
    const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
    
    console.log(`🔍 Google Images search: ${searchUrl}`);
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    
    // Extract image URLs from Google Images results
    const imagePattern = /"ou":"([^"]+)"/g;
    let match;
    
    while ((match = imagePattern.exec(html)) !== null) {
      const imageUrl = decodeURIComponent(match[1]);
      // Prefer eBay, COMC, or other trading card sites
      if (imageUrl.includes('ebay.com') || imageUrl.includes('comc.com') || 
          imageUrl.includes('cardboard') || imageUrl.includes('.jpg')) {
        console.log(`Found Google Images result: ${imageUrl}`);
        return imageUrl;
      }
    }

    return null;
  } catch (error) {
    console.log('Google Images search failed:', error);
    return null;
  }
}

async function performEBaySearch(searchTerms: string): Promise<string | null> {
  try {
    // Use modern eBay Browse API with OAuth2
    const accessToken = await getEBayAccessToken();
    if (!accessToken) {
      console.log('Failed to get eBay access token, skipping eBay search');
      return null;
    }

    const browseApiUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
    const params = new URLSearchParams({
      'q': searchTerms,
      'category_ids': '183454', // Sports Trading Cards
      'limit': '10',
      'fieldgroups': 'EXTENDED'
    });

    console.log(`🔍 eBay Browse API search: "${searchTerms}"`);
    console.log(`📡 API URL: ${browseApiUrl}?${params}`);

    const response = await fetch(`${browseApiUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`eBay Browse API error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return null;
    }

    const data = await response.json();
    console.log(`✅ eBay Browse API response received`);

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      console.log('No items found in eBay Browse API response');
      return null;
    }

    // Find best quality image from results
    for (const item of data.itemSummaries) {
      if (item.image) {
        // Prioritize by image size as ChatGPT suggested
        if (item.image.imageUrl) {
          console.log(`✅ Found high-quality image: ${item.image.imageUrl}`);
          return item.image.imageUrl;
        }
        if (item.additionalImages && item.additionalImages.length > 0) {
          console.log(`✅ Found additional image: ${item.additionalImages[0].imageUrl}`);
          return item.additionalImages[0].imageUrl;
        }
      }
    }

    console.log('No quality images found in eBay Browse API results');
    return null;

  } catch (error) {
    console.error('eBay Browse API search error:', error);
    return null;
  }
}

async function getEBayAccessToken(): Promise<string | null> {
  try {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('eBay OAuth credentials missing');
      return null;
    }

    const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    if (!response.ok) {
      console.error(`eBay OAuth error: ${response.status}`);
      return null;
    }

    const tokenData = await response.json();
    console.log('✅ eBay OAuth token obtained successfully');
    return tokenData.access_token;

  } catch (error) {
    console.error('eBay OAuth error:', error);
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
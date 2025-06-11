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
 * Search eBay for card images using the Finding API
 */
async function searchEBayForCardImage(
  setName: string,
  cardName: string,
  cardNumber: string,
  description?: string
): Promise<string | null> {
  try {
    // Create multiple search strategies with decreasing specificity
    const searchStrategies = [
      // Strategy 1: Set name + card name + card number (as requested)
      [setName, cardName, cardNumber].filter(Boolean).join(' '),
      // Strategy 2: COMC with set + card name + card number
      [setName, cardName, cardNumber, 'comc'].filter(Boolean).join(' '),
      // Strategy 3: COMC consignment format
      [setName, cardName, cardNumber, 'comc_consignment'].filter(Boolean).join(' '),
      // Strategy 4: Card name + set name + card number (reordered)
      [cardName, setName, cardNumber].filter(Boolean).join(' '),
      // Strategy 5: Just card name + "marvel"
      [cardName, 'marvel'].join(' ')
    ].map(query => query.replace(/\s+/g, ' ').trim());

    for (let i = 0; i < searchStrategies.length; i++) {
      const searchTerms = searchStrategies[i];
      console.log(`eBay search attempt ${i + 1}: "${searchTerms}"`);

      const result = await performEBaySearch(searchTerms);
      if (result) {
        console.log(`Found image using search strategy ${i + 1}`);
        return result;
      }
    }

    console.log('No eBay results found with any search strategy');
    return null;

  } catch (error) {
    console.error('eBay search error:', error);
    // Re-throw eBay API errors so they can be handled properly upstream
    if (error instanceof Error && (error.message === 'RATE_LIMIT_EXCEEDED' || error.message.startsWith('EBAY_API_ERROR:'))) {
      throw error;
    }
    return null;
  }
}

async function performEBaySearch(searchTerms: string): Promise<string | null> {
  try {
    // Increment session and daily API call counters
    ebayCallCount++;
    trackDailyApiCall();
    
    console.log(`eBay API call #${ebayCallCount} — keywords: "${searchTerms}"`);
    
    const ebayApiUrl = 'https://svcs.ebay.com/services/search/FindingService/v1';
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findItemsByKeywords',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': process.env.EBAY_APP_ID_PROD || process.env.EBAY_APP_ID || '',
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

    console.log(`Full eBay API URL: ${ebayApiUrl}?${params}`);
    const response = await fetch(`${ebayApiUrl}?${params}`);
    
    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error(`Failed to parse eBay API response: ${parseError}`);
      return null;
    }
    
    // Improved eBay API error logging - capture full error response
    const ebayError = data?.errorMessage?.[0]?.error?.[0];
    if (ebayError) {
      console.error('eBay API error:', JSON.stringify(ebayError, null, 2));
      throw new Error(`EBAY_API_ERROR: ${ebayError.errorId?.[0]} - ${ebayError.message?.[0]}`);
    }
    
    if (!response.ok) {
      console.error(`eBay API HTTP error: ${response.status} ${response.statusText}`);
      console.error('Response body:', JSON.stringify(data, null, 2));
      return null;
    }
    
    console.log(`eBay API response for "${searchTerms}":`, JSON.stringify(data, null, 2));

    if (!data.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item) {
      console.log(`No items found in eBay response for "${searchTerms}"`);
      return null;
    }

    const items = data.findItemsByKeywordsResponse[0].searchResult[0].item;
    
    // Find the first item with a high-quality image
    for (const item of items) {
      // Prefer pictureURLSuperSize
      if (item.pictureURLSuperSize?.[0]) {
        console.log(`Found super size image for "${searchTerms}"`);
        return item.pictureURLSuperSize[0];
      }
      
      // Fallback to pictureURLLarge
      if (item.pictureURLLarge?.[0]) {
        console.log(`Found large image for "${searchTerms}"`);
        return item.pictureURLLarge[0];
      }
      
      // Final fallback to galleryURL
      if (item.galleryURL?.[0]) {
        console.log(`Found gallery image for "${searchTerms}"`);
        return item.galleryURL[0];
      }
    }

    console.log('No quality images found in eBay results');
    return null;

  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMIT_EXCEEDED') {
      throw error;
    }
    console.error('eBay search error:', error);
    return null;
  }
}

/**
 * Upload image to Cloudinary from URL
 */
async function uploadImageToCloudinary(imageUrl: string, cardId: number): Promise<string | null> {
  try {
    console.log(`Uploading image to Cloudinary for card ${cardId}`);
    
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'marvel-cards',
      public_id: `card_${cardId}_${Date.now()}`,
      transformation: [
        { width: 400, height: 560, crop: 'fit', quality: 'auto' },
        { format: 'webp' }
      ]
    });

    console.log(`Successfully uploaded to Cloudinary: ${result.secure_url}`);
    return result.secure_url;

  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return null;
  }
}

/**
 * Find and update a single card's image
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

  try {
    // Search eBay for image
    const ebayImageUrl = await searchEBayForCardImage(setName, cardName, cardNumber, description);
    
    if (!ebayImageUrl) {
      result.error = 'No image found on eBay';
      return result;
    }

    result.originalImageUrl = ebayImageUrl;

    // Upload to Cloudinary
    const cloudinaryUrl = await uploadImageToCloudinary(ebayImageUrl, cardId);
    
    if (!cloudinaryUrl) {
      result.error = 'Failed to upload to Cloudinary';
      return result;
    }

    result.newImageUrl = cloudinaryUrl;

    // Update card in database
    await storage.updateCard(cardId, {
      name: cardName,
      setId: 0, // Will be ignored in update
      cardNumber,
      rarity: '', // Will be ignored in update
      frontImageUrl: cloudinaryUrl
    });

    result.success = true;
    console.log(`Successfully updated card ${cardId} with new image`);
    
    return result;

  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'RATE_LIMIT_EXCEEDED') {
        result.error = 'eBay API daily rate limit exceeded (10,000 requests/day). Please try again tomorrow.';
        console.error(`eBay API rate limit exceeded for card ${cardId}`);
      } else if (error.message.startsWith('EBAY_API_ERROR:')) {
        result.error = error.message.replace('EBAY_API_ERROR: ', 'eBay API Error: ');
        console.error(`eBay API error for card ${cardId}: ${error.message}`);
      } else {
        result.error = `Error: ${error.message}`;
        console.error(`Error updating card ${cardId}:`, error);
      }
    } else {
      result.error = `Error: ${error}`;
      console.error(`Error updating card ${cardId}:`, error);
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
    
    return results;

  } catch (error) {
    console.error('Batch update error:', error);
    return results;
  }
}

/**
 * Test function with sample card data
 */
export async function testImageFinder() {
  console.log('Testing image finder with sample data...');
  
  const sampleCards = [
    {
      id: 999999, // Test ID
      setName: 'Marvel 2024 skybox masterpieces xl Gold Foil',
      cardName: 'Multiple Man',
      cardNumber: '10',
      description: 'Gold Foil'
    }
  ];

  const results = [];
  
  for (const card of sampleCards) {
    const result = await findAndUpdateCardImage(
      card.id,
      card.setName,
      card.cardName,
      card.cardNumber,
      card.description
    );
    results.push(result);
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('Test results:', results);
  return results;
}
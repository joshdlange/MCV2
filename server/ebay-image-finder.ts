import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import { storage } from './storage';

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
    // Clean and build search query
    const searchTerms = [setName, cardName, cardNumber, description]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log(`Searching eBay for: "${searchTerms}"`);

    const ebayApiUrl = 'https://svcs.ebay.com/services/search/FindingService/v1';
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findItemsByKeywords',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': process.env.EBAY_APP_ID || '',
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': '',
      'keywords': searchTerms,
      'categoryId': '183454', // Sports Trading Cards category
      'sortOrder': 'BestMatch',
      'paginationInput.entriesPerPage': '10',
      'paginationInput.pageNumber': '1',
      'itemFilter(0).name': 'Condition',
      'itemFilter(0).value': 'New',
      'itemFilter(1).name': 'ListingType',
      'itemFilter(1).value': 'FixedPrice',
      'outputSelector(0)': 'PictureURLSuperSize',
      'outputSelector(1)': 'PictureURLLarge',
      'outputSelector(2)': 'GalleryInfo'
    });

    const response = await fetch(`${ebayApiUrl}?${params}`);
    const data = await response.json() as any;

    if (!data.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item) {
      console.log('No eBay results found for search terms');
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
    result.error = `Error: ${error}`;
    console.error(`Error updating card ${cardId}:`, error);
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
      
      const result = await findAndUpdateCardImage(
        card.id,
        card.set.name || '',
        card.name,
        card.cardNumber,
        card.description || undefined
      );
      
      results.push(result);
      
      // Rate limiting: 1 request per second
      if (i < cardsWithoutImages.length - 1) {
        console.log('Waiting 1 second before next request...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Batch update complete: ${successCount}/${results.length} cards updated successfully`);
    
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
      setName: '1992 Marvel Masterpieces',
      cardName: 'Spider-Man',
      cardNumber: '1',
      description: 'Web Slinger'
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
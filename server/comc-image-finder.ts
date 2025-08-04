import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import { db } from './db';
import { cards } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface COMCSearchResult {
  success: boolean;
  newImageUrl?: string;
  error?: string;
}

/**
 * Get eBay OAuth2 Access Token
 */
async function getEBayAccessToken(): Promise<string | null> {
  try {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('❌ eBay OAuth credentials missing');
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
      console.error(`❌ eBay OAuth error: ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    return data.access_token;

  } catch (error) {
    console.error('❌ Error getting eBay access token:', error);
    return null;
  }
}

/**
 * Search eBay for a specific card using Browse API (improved matching)
 */
async function searchCOMCForCardImage(setName: string, cardName: string, cardNumber: string, accessToken: string): Promise<string | null> {
  try {
    // FIXED: Remove COMC requirement - search all eBay for better matches
    const query = `${setName} ${cardName} ${cardNumber}`.replace(/\s+/g, ' ').trim();
    console.log(`[IMAGE DEBUG] Query: "${query}"`);
    console.log(`[IMAGE DEBUG] Individual parts: setName="${setName}", cardName="${cardName}", cardNumber="${cardNumber}"`);

    const searchUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
    const params = new URLSearchParams({
      q: query,
      limit: '30', // Increase limit for better matches
      sort: 'price' // Sort by price to get consistent results
    });

    const response = await fetch(`${searchUrl}?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });

    if (!response.ok) {
      console.error(`❌ eBay Browse API error: ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    
    console.log(`[IMAGE DEBUG] eBay API response status: ${response.status}`);
    console.log(`[IMAGE DEBUG] Total items found: ${data.itemSummaries?.length || 0}`);
    
    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      console.log('📭 No items found on eBay');
      return null;
    }

    // Look for exact matches with improved logic
    for (const item of data.itemSummaries) {
      const title = item.title.toLowerCase();
      const cardNameLower = cardName.toLowerCase();
      
      // SIMPLIFIED: Use flexible matching that actually works
      const hasCardName = cardNameLower.split(' ').some(word => 
        word.length > 2 && title.includes(word) // At least one significant word must match
      );
      
      // SIMPLIFIED: Basic card number matching
      const hasCardNumber = cardNumber ? (
        title.includes(`#${cardNumber}`) || 
        title.includes(` ${cardNumber} `) ||
        new RegExp(`\\b${cardNumber}\\b`).test(title)
      ) : true;
      
      // SIMPLIFIED: Basic trading card verification
      const isLikelyCard = (
        title.includes('upper deck') ||
        title.includes('marvel') ||
        title.includes('#')
      );
      
      console.log(`[IMAGE DEBUG] Checking: "${item.title}"`); 
      console.log(`[IMAGE DEBUG] hasCardName: ${hasCardName}, hasCardNumber: ${hasCardNumber}, isLikelyCard: ${isLikelyCard}`);
      
      // FIXED: Accept more matches - be less restrictive
      if ((hasCardName && hasCardNumber) || (hasCardName && isLikelyCard && cardNumber && title.includes(cardNumber))) {
        const imageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`✅ Found matching card: ${imageUrl}`);
          console.log(`[IMAGE DEBUG] Matched title: "${item.title}"`);
          return imageUrl;
        }
      }
    }

    console.log('📭 No exact match found');
    return null;

  } catch (error) {
    console.error('❌ Error searching eBay:', error);
    return null;
  }
}

/**
 * Upload image to Cloudinary
 */
async function uploadToCloudinary(imageUrl: string, cardId: number): Promise<string | null> {
  try {
    console.log(`☁️ Uploading to Cloudinary for card ${cardId}`);
    
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'marvel-cards',
      public_id: `card_${cardId}_${Date.now()}`,
      transformation: [
        { width: 500, height: 700, crop: 'fit', quality: 'auto:good' }
      ]
    });

    console.log(`✅ Cloudinary upload successful: ${result.secure_url}`);
    return result.secure_url;

  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    return null;
  }
}

/**
 * Update card in database with new image URL
 */
async function updateCardImage(cardId: number, imageUrl: string): Promise<boolean> {
  try {
    await db
      .update(cards)
      .set({ 
        frontImageUrl: imageUrl
      })
      .where(eq(cards.id, cardId));

    console.log(`✅ Database updated for card ${cardId}`);
    return true;

  } catch (error) {
    console.error(`❌ Database update error for card ${cardId}:`, error);
    return false;
  }
}

/**
 * Main function to search eBay for a card and update if found
 */
export async function searchCOMCForCard(
  cardId: number,
  setName: string,
  cardName: string,
  cardNumber: string
): Promise<COMCSearchResult> {
  try {
    // Get eBay access token
    const accessToken = await getEBayAccessToken();
    if (!accessToken) {
      return { success: false, error: 'Failed to get eBay access token' };
    }

    // Search eBay for card images
    const imageUrl = await searchCOMCForCardImage(setName, cardName, cardNumber, accessToken);
    if (!imageUrl) {
      return { success: false, error: 'No exact match found on eBay' };
    }

    // Upload to Cloudinary
    const cloudinaryUrl = await uploadToCloudinary(imageUrl, cardId);
    if (!cloudinaryUrl) {
      return { success: false, error: 'Failed to upload to Cloudinary' };
    }

    // Update database
    const updated = await updateCardImage(cardId, cloudinaryUrl);
    if (!updated) {
      return { success: false, error: 'Failed to update database' };
    }

    console.log(`🎉 SUCCESS: Card ${cardId} updated with COMC image`);
    return { success: true, newImageUrl: cloudinaryUrl };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`🚨 Error processing card ${cardId}:`, error);
    return { success: false, error: errorMessage };
  }
}
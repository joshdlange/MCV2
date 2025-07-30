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
 * Search COMC eBay store for a specific card using Browse API
 */
async function searchCOMCForCardImage(setName: string, cardName: string, cardNumber: string, accessToken: string): Promise<string | null> {
  try {
    // Build search query for exact match in COMC store
    const query = `${setName} ${cardName} ${cardNumber}`.trim();
    console.log(`🔍 COMC Search: "${query}"`);

    const searchUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
    const params = new URLSearchParams({
      q: query,
      limit: '10',
      filter: 'sellers:comc' // Only search COMC's eBay store
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
    
    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      console.log('📭 No items found in COMC store');
      return null;
    }

    // Look for exact matches first (using same logic as working standalone script)
    for (const item of data.itemSummaries) {
      const title = item.title.toLowerCase();
      const queryLower = query.toLowerCase();
      
      // Check if this is a good match (contains key components)
      if (title.includes(cardName.toLowerCase()) && 
          (cardNumber ? title.includes(cardNumber) : true)) {
        
        const imageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`✅ Found COMC exact match: ${imageUrl}`);
          return imageUrl;
        }
      }
    }

    console.log('📭 No exact match found in COMC store');
    return null;

  } catch (error) {
    console.error('❌ Error searching COMC store:', error);
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
 * Main function to search COMC for a card and update if found
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

    // Search COMC store
    const imageUrl = await searchCOMCForCardImage(setName, cardName, cardNumber, accessToken);
    if (!imageUrl) {
      return { success: false, error: 'No exact match found in COMC store' };
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
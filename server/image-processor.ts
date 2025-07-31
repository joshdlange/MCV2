import { storage } from "./storage";
import { uploadImage } from "./cloudinary";
import fs from "fs";
import path from "path";

// Check if an image URL should be processed (not already on Cloudinary)
function shouldProcessImage(url: string): boolean {
  if (!url) return false;
  
  // Skip if already on Cloudinary AND it's not a low-quality image we need to reprocess
  if (url.includes("cloudinary.com")) {
    // Don't reprocess unless we suspect it came from a low-quality source
    return false;
  }
  
  // Process Google Drive URLs, Google Storage URLs, and other external URLs
  return url.includes("drive.google.com") || 
         url.includes("storage.googleapis.com") || 
         url.includes("pricecharting.com") ||
         (!url.startsWith("/uploads/") && !url.startsWith("http://localhost") && !url.startsWith("https://localhost"));
}

// Convert Google Drive URLs to direct download URLs
function convertGoogleDriveUrl(url: string): string {
  if (!url.includes("drive.google.com")) {
    return url;
  }
  
  // Extract file ID from various Google Drive URL formats
  let fileId = "";
  
  if (url.includes("/file/d/")) {
    fileId = url.split("/file/d/")[1].split("/")[0];
  } else if (url.includes("id=")) {
    fileId = url.split("id=")[1].split("&")[0];
  }
  
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  
  return url;
}

// Try to get higher resolution version of image URLs
function getHigherResolutionUrl(url: string): string {
  // For PriceCharting images, try to get larger versions
  if (url.includes("pricecharting.com") && url.includes("/60.jpg")) {
    // Try different sizes: 300, 500, 800, or original
    return url.replace("/60.jpg", "/500.jpg");
  }
  
  return url;
}

// Function to download and upload image to Cloudinary (CLOUDINARY-ONLY - NO LOCAL FILES)
async function downloadAndUploadToCloudinary(url: string, folder: string = 'marvel-cards'): Promise<string | null> {
  try {
    // NO LOCAL DIRECTORY CREATION - streaming directly to Cloudinary

    // Try to get higher resolution version
    let processUrl = getHigherResolutionUrl(url);
    
    // Convert Google Drive URL to direct download URL
    processUrl = convertGoogleDriveUrl(processUrl);
    
    // Download the image
    const response = await fetch(processUrl);
    if (!response.ok) {
      console.error(`Failed to download image from ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    // Get file extension from content type or URL
    const contentType = response.headers.get("content-type");
    let extension = ".jpg"; // default
    if (contentType?.includes("png")) extension = ".png";
    if (contentType?.includes("gif")) extension = ".gif";
    if (contentType?.includes("webp")) extension = ".webp";

    // Stream directly to Cloudinary instead of saving locally
    const buffer = await response.arrayBuffer();
    
    // Upload buffer directly to Cloudinary (no local file system usage)
    const cloudinaryUrl = await uploadImage(Buffer.from(buffer), folder);
    
    // No temporary file cleanup needed - we never saved to disk

    return cloudinaryUrl;
  } catch (error) {
    console.error(`Error processing image from ${url}:`, error);
    return null;
  }
}

// Function to process images for cards and card sets
export async function processImages() {
  try {
    console.log("Image processing disabled - use admin interface to process images manually");
    return;
    
    // Get all cards with Google Drive URLs
    const allCards = await storage.getCards();
    
    for (const card of allCards) {
      let updated = false;
      const updates: any = {};

      // Process front image - check for any external URL that needs processing
      if (card.frontImageUrl && shouldProcessImage(card.frontImageUrl)) {
        console.log(`Processing front image for card ${card.id}: ${card.name}`);
        const cloudinaryUrl = await downloadAndUploadToCloudinary(card.frontImageUrl, 'marvel-cards');
        if (cloudinaryUrl) {
          updates.frontImageUrl = cloudinaryUrl;
          updated = true;
        }
      }

      // Process back image - check for any external URL that needs processing
      if (card.backImageUrl && shouldProcessImage(card.backImageUrl)) {
        console.log(`Processing back image for card ${card.id}: ${card.name}`);
        const cloudinaryUrl = await downloadAndUploadToCloudinary(card.backImageUrl, 'marvel-cards');
        if (cloudinaryUrl) {
          updates.backImageUrl = cloudinaryUrl;
          updated = true;
        }
      }

      // Update card if we downloaded any images
      if (updated) {
        await storage.updateCard(card.id, updates);
        console.log(`Updated card ${card.id} with local image URLs`);
      }
    }

    // Get all card sets with external URLs that need processing
    const allSets = await storage.getCardSets();
    
    for (const set of allSets) {
      if (set.imageUrl && shouldProcessImage(set.imageUrl)) {
        console.log(`Processing image for set ${set.id}: ${set.name}`);
        const cloudinaryUrl = await downloadAndUploadToCloudinary(set.imageUrl, 'card-sets');
        if (cloudinaryUrl) {
          await storage.updateCardSet(set.id, { imageUrl: cloudinaryUrl });
          console.log(`Updated set ${set.id} with Cloudinary URL`);
        }
      }
    }

    console.log("Image processing completed!");
  } catch (error) {
    console.error("Error during image processing:", error);
  }
}

// Start processing images in the background with a delay
export function startImageProcessor() {
  // Process images only once per hour to minimize resource usage
  const PROCESS_INTERVAL = 3600000; // 1 hour
  
  // Initial delay of 30 seconds after server start
  setTimeout(() => {
    processImages();
    
    // Then process every hour
    setInterval(() => {
      processImages();
    }, PROCESS_INTERVAL);
  }, 30000);
}
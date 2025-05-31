import { storage } from "./storage";
import fs from "fs";
import path from "path";

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

// Function to download and save an image from URL
async function downloadAndSaveImage(url: string): Promise<string | null> {
  try {
    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Convert Google Drive URL to direct download URL
    const directUrl = convertGoogleDriveUrl(url);
    
    // Download the image
    const response = await fetch(directUrl);
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

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const filename = `image_${timestamp}_${randomString}${extension}`;
    const filepath = path.join(uploadsDir, filename);

    // Save the image
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filepath, Buffer.from(buffer));

    // Return the local URL
    return `/uploads/${filename}`;
  } catch (error) {
    console.error(`Error downloading image from ${url}:`, error);
    return null;
  }
}

// Function to process images for cards and card sets
export async function processImages() {
  try {
    console.log("Starting image processing...");
    
    // Get all cards with Google Drive URLs
    const allCards = await storage.getCards();
    
    for (const card of allCards) {
      let updated = false;
      const updates: any = {};

      // Process front image
      if (card.frontImageUrl && card.frontImageUrl.includes("drive.google.com")) {
        console.log(`Processing front image for card ${card.id}: ${card.name}`);
        const localUrl = await downloadAndSaveImage(card.frontImageUrl);
        if (localUrl) {
          updates.frontImageUrl = localUrl;
          updated = true;
        }
      }

      // Process back image
      if (card.backImageUrl && card.backImageUrl.includes("drive.google.com")) {
        console.log(`Processing back image for card ${card.id}: ${card.name}`);
        const localUrl = await downloadAndSaveImage(card.backImageUrl);
        if (localUrl) {
          updates.backImageUrl = localUrl;
          updated = true;
        }
      }

      // Update card if we downloaded any images
      if (updated) {
        await storage.updateCard(card.id, updates);
        console.log(`Updated card ${card.id} with local image URLs`);
      }
    }

    // Get all card sets with Google Drive URLs
    const allSets = await storage.getCardSets();
    
    for (const set of allSets) {
      if (set.imageUrl && set.imageUrl.includes("drive.google.com")) {
        console.log(`Processing image for set ${set.id}: ${set.name}`);
        const localUrl = await downloadAndSaveImage(set.imageUrl);
        if (localUrl) {
          await storage.updateCardSet(set.id, { imageUrl: localUrl });
          console.log(`Updated set ${set.id} with local image URL`);
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
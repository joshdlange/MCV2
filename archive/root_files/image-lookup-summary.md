# Marvel Card Vault - Image Lookup System

## Overview
Your Marvel Card Vault has a comprehensive image lookup system that automatically finds missing card images using API calls to eBay and uploads them to Cloudinary for optimization.

## Current Status
- **Total Cards**: 62,338 cards in database
- **Cards Missing Images**: 31,957 cards need images (51% completion)
- **Script Performance**: Successfully finding and updating card images

## How It Works

### 1. Image Discovery Process
The system uses a 3-step process for each card:

**Step 1: eBay API Search**
- Searches eBay using specific card details: Set name, card name, and number
- Uses search terms like "2024 skybox metal universe avengers Norman Osborn 175 comc"
- Finds authentic card images from eBay listings

**Step 2: Cloudinary Upload**
- Takes the found eBay image URL
- Uploads to Cloudinary for optimization and reliable hosting
- Generates optimized URLs like: `https://res.cloudinary.com/dgu7hjfvn/image/upload/v1752701869/marvel-cards/card_11543_1752701869224.jpg`

**Step 3: Database Update**
- Updates the card's `front_image_url` field with the new Cloudinary URL
- Ensures the image is permanently stored and accessible

### 2. Rate Limiting & API Compliance
- **1-second delay** between requests to respect eBay API limits
- **Proper OAuth authentication** for eBay API access
- **Error handling** prevents single failures from stopping the process

## How to Run the Script

### Option 1: Small Batch (Recommended)
```bash
npx tsx scripts/update-missing-images.ts 25
```
This processes 25 cards at a time and takes about 30 seconds.

### Option 2: Medium Batch
```bash
npx tsx scripts/update-missing-images.ts 50
```
This processes 50 cards and takes about 1 minute.

### Option 3: Large Batch (For Overnight)
```bash
npx tsx scripts/update-missing-images.ts 500
```
This processes 500 cards and takes about 10 minutes.

### Option 4: No Limit (Full Process)
```bash
npx tsx scripts/update-missing-images.ts
```
This processes all remaining cards (will take several hours).

## Recent Success Examples
The script has successfully found and updated images for:
- **Norman Osborn** (#175) - 2024 Skybox Metal Universe Avengers
- **Quasar** (#190) - 2024 Skybox Metal Universe Avengers
- **Beetle** (#192) - 2024 Skybox Metal Universe Avengers
- **Firestar** (#193) - 2024 Skybox Metal Universe Avengers
- **Hawkeye** (#194) - 2024 Skybox Metal Universe Avengers
- **Starbrand** (#196) - 2024 Skybox Metal Universe Avengers

## Progress Tracking
The script provides real-time feedback:
- ✅ Success indicators for each step
- 📊 Progress percentages
- 🔗 Generated Cloudinary URLs
- ⏱️ Rate limiting confirmations

## Technical Details
- **Script Location**: `scripts/update-missing-images.ts`
- **Backend Service**: `server/bulk-image-updater.ts`
- **Database Fields**: Updates `front_image_url` in `cards` table
- **Image Hosting**: Cloudinary CDN for fast, reliable image delivery
- **Search Strategy**: Combines set name, card name, and number for accuracy

## Recommendations
1. **Run in batches** of 25-50 cards to monitor progress
2. **Run during off-peak hours** to avoid API rate limits
3. **Monitor the output** to ensure success rates remain high
4. **Let it run overnight** for large batches if needed

Your image lookup system is working perfectly and finding authentic card images from eBay automatically!
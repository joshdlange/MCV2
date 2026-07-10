/**
 * Upload the PC Binder screenshot to Cloudinary for email use.
 * Run: npx tsx scripts/upload-binder-screenshot.ts
 */
import { v2 as cloudinary } from 'cloudinary';
import path from 'path';

// Support CLOUDINARY_URL or individual vars
if (process.env.CLOUDINARY_URL) {
  cloudinary.config(true);
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const imagePath = path.resolve('attached_assets/image_1783695359809.png');

(async () => {
  console.log('Uploading PC Binder screenshot to Cloudinary...');
  const result = await cloudinary.uploader.upload(imagePath, {
    folder: 'marvel-card-vault/email-assets',
    public_id: 'pc-binder-screenshot',
    overwrite: true,
    transformation: [{ width: 520, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
  });
  console.log('✅ Uploaded:', result.secure_url);
})().catch(err => {
  console.error('❌ Upload failed:', err.message);
  process.exit(1);
});

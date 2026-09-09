import { Request, Response } from 'express';
import { downloadPublicImage } from './services/imageMigration';

// Cache for storing image responses to avoid repeated requests
const imageCache = new Map<string, { data: Buffer; contentType: string; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const ALLOWED_IMAGE_DOMAINS = [
  'storage.googleapis.com',
  'images.pricecharting.com',
  'drive.google.com',
  'res.cloudinary.com',
  'ebayimg.com',
  'walmartimages.com',
  'cdn.shopify.com',
  'media-amazon.com',
  'assets.dacw.co',
  'dacardworld1.imgix.net',
  'collectorsavenue.com',
  'tradercracks.com',
  'thetoytemple.com',
] as const;

export function normalizeProxiedImageUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2_048) return null;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const allowed = ALLOWED_IMAGE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (!allowed) return null;

    if (hostname === 'drive.google.com') {
      const fileIdMatch = parsed.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
      if (fileIdMatch) {
        return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
      }
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function proxyImage(req: Request, res: Response) {
  try {
    const imageUrl = normalizeProxiedImageUrl(req.query.url);
    if (!imageUrl) {
      return res.status(400).json({ error: 'Invalid or disallowed image URL' });
    }

    // Check cache first
    const cached = imageCache.get(imageUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
      return res.send(cached.data);
    }

    const { contentType, buffer } = await downloadPublicImage(
      imageUrl,
      3,
      ALLOWED_IMAGE_DOMAINS,
    );

    // Cache the result
    imageCache.set(imageUrl, {
      data: buffer,
      contentType,
      timestamp: Date.now()
    });

    // Clean up old cache entries (simple cleanup)
    if (imageCache.size > 1000) {
      const entries = Array.from(imageCache.entries());
      const oldEntries = entries.filter(([_, value]) => 
        Date.now() - value.timestamp > CACHE_DURATION
      );
      oldEntries.forEach(([key]) => imageCache.delete(key));
    }

    res.set('Content-Type', contentType);
    res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.send(buffer);

  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
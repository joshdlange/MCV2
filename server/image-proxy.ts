import { Request, Response } from 'express';
import fetch from 'node-fetch';

// Cache for storing image responses to avoid repeated requests
const imageCache = new Map<string, { data: Buffer; contentType: string; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function proxyImage(req: Request, res: Response) {
  try {
    let imageUrl = req.query.url as string;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Convert Google Drive URLs to direct download format
    if (imageUrl.includes('drive.google.com')) {
      const fileIdMatch = imageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        imageUrl = `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
      }
    }

    // Validate URL to prevent abuse
    const allowedDomains = [
      'storage.googleapis.com',
      'images.pricecharting.com',
      'drive.google.com',
      'res.cloudinary.com'
    ];
    
    const isAllowed = allowedDomains.some(domain => imageUrl.includes(domain));
    if (!isAllowed) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    // Check cache first
    const cached = imageCache.get(imageUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
      return res.send(cached.data);
    }

    // Fetch image from external source
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Referer': 'https://www.pricecharting.com/',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: 'Failed to fetch image' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.buffer();

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
    res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.send(buffer);

  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
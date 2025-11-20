import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  url?: string;
}

export interface ScrapedSetData {
  setName?: string;
  keyHighlights?: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  manufacturer?: string;
  releaseDateEstimated?: Date;
}

/**
 * Fetches a URL and extracts OpenGraph metadata
 */
export async function scrapeOpenGraphMetadata(url: string): Promise<OpenGraphData> {
  try {
    // Validate URL
    const parsedUrl = new URL(url);
    
    // Fetch the page with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarvelCardVault/1.0; +https://marvelcardvault.com)',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract OpenGraph metadata
    const ogData: OpenGraphData = {
      title: $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content'),
      description: $('meta[property="og:description"]').attr('content') || $('meta[name="twitter:description"]').attr('content') || $('meta[name="description"]').attr('content'),
      image: $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'),
      siteName: $('meta[property="og:site_name"]').attr('content'),
      url: $('meta[property="og:url"]').attr('content') || url,
    };

    // Clean up image URL (remove tracking params)
    if (ogData.image) {
      ogData.image = sanitizeImageUrl(ogData.image);
    }

    return ogData;
  } catch (error) {
    console.error('OpenGraph scraping error:', error);
    throw new Error(`Failed to scrape URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Converts OpenGraph data to upcoming set data structure
 */
export function convertOGDataToSetData(ogData: OpenGraphData, sourceUrl: string): ScrapedSetData {
  const setData: ScrapedSetData = {
    sourceUrl,
    setName: ogData.title,
    keyHighlights: ogData.description,
    thumbnailUrl: ogData.image,
  };

  // Try to extract manufacturer from site name
  if (ogData.siteName) {
    setData.manufacturer = ogData.siteName;
  }

  // Try to parse a date from the description or title
  const dateMatch = extractDateFromText(ogData.title || ogData.description || '');
  if (dateMatch) {
    setData.releaseDateEstimated = dateMatch;
  }

  return setData;
}

/**
 * Removes tracking query parameters from image URLs
 */
function sanitizeImageUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    // Remove common tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    trackingParams.forEach(param => url.searchParams.delete(param));
    return url.toString();
  } catch {
    // If URL parsing fails, return original
    return imageUrl;
  }
}

/**
 * Attempts to extract a date from text
 */
function extractDateFromText(text: string): Date | null {
  // Common date patterns
  const patterns = [
    // "December 2025", "Jan 2024"
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2},?\s+)?(\d{4})\b/i,
    // "2025-01-15", "2024/12/25"
    /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/,
    // "01/15/2025", "12-25-2024"
    /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const dateStr = match[0];
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2024 && parsed.getFullYear() <= 2030) {
          return parsed;
        }
      } catch {
        // Continue to next pattern
      }
    }
  }

  return null;
}

/**
 * All-in-one function to scrape and convert URL to set data
 */
export async function scrapeSetDataFromUrl(url: string): Promise<ScrapedSetData> {
  const ogData = await scrapeOpenGraphMetadata(url);
  return convertOGDataToSetData(ogData, url);
}

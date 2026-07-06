import OpenAI from 'openai';
import sharp from 'sharp';
import {
  matchCandidates,
  extractHintsFromText,
  extractKeywords,
  normalizeCardNumber,
  type ParsedScan,
  type ScoredMatch,
} from './scanMatching';

export const FREE_SCAN_LIMIT_PER_MONTH = 25;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

interface CardVisionResult {
  ocrText: string | null;
  characterName: string | null;
  setName: string | null;
  subsetName: string | null;
  cardNumber: string | null;
  year: string | null;
  brand: string | null;
  variant: string | null;
  copyrightLine: string | null;
  serialIndicator: string | null;
}

export interface ScanMatch extends ScoredMatch {}

export interface ScanResult {
  ocrText: string;
  parsed: {
    characterName: string | null;
    setName: string | null;
    subsetName: string | null;
    cardNumber: string | null;
    normalizedCardNumber: string | null;
    year: string | null;
    brand: string | null;
    variant: string | null;
    setCandidates: string[];
    keywords: string[];
  };
  matches: ScanMatch[];
  confidenceLevel: 'high' | 'medium' | 'low' | 'none';
  preprocessed: boolean;
}

const EMPTY_VISION: CardVisionResult = {
  ocrText: null,
  characterName: null,
  setName: null,
  subsetName: null,
  cardNumber: null,
  year: null,
  brand: null,
  variant: null,
  copyrightLine: null,
  serialIndicator: null,
};

/**
 * Preprocess the image before sending it to the vision model: normalize
 * orientation (EXIF), upscale small images, and boost contrast slightly.
 * This helps OCR quality on photos taken at odd angles or low light.
 */
async function preprocessImage(imageBuffer: Buffer): Promise<{ buffer: Buffer; preprocessed: boolean }> {
  try {
    const image = sharp(imageBuffer).rotate(); // auto-orient via EXIF
    const metadata = await image.metadata();

    let pipeline = image;
    const width = metadata.width || 0;

    // Upscale small/low-res images so the model has more detail to work with.
    if (width > 0 && width < 1000) {
      pipeline = pipeline.resize({ width: 1200, withoutEnlargement: false });
    } else if (width > 2400) {
      // Downscale very large images to keep payload size reasonable.
      pipeline = pipeline.resize({ width: 2400 });
    }

    pipeline = pipeline.normalize().sharpen();

    const buffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
    return { buffer, preprocessed: true };
  } catch (err) {
    console.error('[Scan] Image preprocessing failed, using original image:', err);
    return { buffer: imageBuffer, preprocessed: false };
  }
}

async function identifyCardWithVision(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<CardVisionResult> {
  if (!openai) {
    console.warn('[Scan] OPENAI_API_KEY not set — vision unavailable');
    return EMPTY_VISION;
  }

  const base64 = imageBuffer.toString('base64');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are a Marvel trading card identification expert. Carefully read every piece of text visible on this trading card image, including small print near the borders (copyright line, serial numbers, set logos, foil stamps).

First, transcribe ALL text you can see on the card into "ocrText" — every word, number, and symbol, in reading order, exactly as printed (this is your raw OCR pass).

Then use that text plus the visual design to fill in the structured fields below. If a field cannot be determined with reasonable confidence, use null — do not guess.

Return ONLY a JSON object with this exact shape:
{
  "ocrText": "Full raw transcription of all visible text on the card",
  "characterName": "The character's name exactly as printed (e.g. Spider-Man, Wolverine, Iron Man) or null",
  "setName": "The card set/product name as printed or inferred from logos (e.g. Marvel Masterpieces, Fleer Ultra X-Men, Upper Deck Marvel Beginnings) or null",
  "subsetName": "Subset, insert, or parallel type if visible (e.g. Canvas, Gold Foil Signature, Printing Plate Black, Rookie Insert) or null",
  "cardNumber": "Card number exactly as printed including any letter prefix (e.g. 85, PP-5, MM23, 12/100) or null",
  "year": "4-digit copyright/print year, usually near a small (c) copyright line, or null",
  "brand": "Card manufacturer only (e.g. SkyBox, Upper Deck, Topps, Fleer, Impel, Panini) or null",
  "variant": "Variant/parallel description if different from subsetName (e.g. Refractor, Gold, Silver Signature) or null",
  "copyrightLine": "The small copyright/legal text line if visible, verbatim, or null",
  "serialIndicator": "Serial numbering if visible, e.g. '23/100' or null"
}
Return ONLY the JSON object. No explanation, no markdown, no code fences.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
        ],
      }],
    });

    const text = (response.choices[0]?.message?.content || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...EMPTY_VISION, ...parsed };
    }
  } catch (err) {
    console.error('[Scan] Vision API error:', err);
  }

  return EMPTY_VISION;
}

function buildParsedScan(vision: CardVisionResult): ParsedScan {
  const rawText = vision.ocrText || '';
  const hints = extractHintsFromText(rawText);

  // Prefer the model's structured cardNumber field, but fall back to a
  // regex-extracted candidate from the raw OCR text if the model missed it.
  const cardNumber = vision.cardNumber || vision.serialIndicator || hints.cardNumberCandidates[0] || null;
  const year = vision.year || hints.yearCandidates[0] || null;
  const setName = vision.setName || hints.setNameCandidates[0] || null;

  const keywordSource = [
    vision.characterName,
    vision.setName,
    vision.subsetName,
    vision.variant,
    rawText,
  ].filter(Boolean).join(' ');

  return {
    characterName: vision.characterName,
    setName,
    subsetName: vision.subsetName,
    cardNumber,
    year,
    brand: vision.brand,
    variant: vision.variant,
    copyrightLine: vision.copyrightLine,
    serialIndicator: vision.serialIndicator,
    keywords: extractKeywords(keywordSource),
  };
}

export async function scanCard(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<ScanResult> {
  const { buffer: processedBuffer, preprocessed } = await preprocessImage(imageBuffer);
  const outputMime = preprocessed ? 'image/jpeg' : mimeType;

  const vision = await identifyCardWithVision(processedBuffer, outputMime);
  console.log('[Scan] Vision result:', JSON.stringify(vision));

  const parsed = buildParsedScan(vision);
  const matches = await matchCandidates(parsed);
  const confidenceLevel = matches.length > 0 ? matches[0].confidenceLevel : 'none';

  const ocrText = vision.ocrText || [
    vision.characterName,
    vision.setName,
    vision.year,
    vision.cardNumber ? `#${vision.cardNumber}` : null,
    vision.variant || vision.subsetName,
  ].filter(Boolean).join(' ');

  return {
    ocrText,
    parsed: {
      characterName: parsed.characterName,
      setName: parsed.setName,
      subsetName: parsed.subsetName,
      cardNumber: parsed.cardNumber,
      normalizedCardNumber: parsed.cardNumber ? normalizeCardNumber(parsed.cardNumber) : null,
      year: parsed.year,
      brand: parsed.brand,
      variant: parsed.variant,
      setCandidates: extractHintsFromText(ocrText).setNameCandidates,
      keywords: parsed.keywords,
    },
    matches,
    confidenceLevel,
    preprocessed,
  };
}

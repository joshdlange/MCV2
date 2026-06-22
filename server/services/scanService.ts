import OpenAI from 'openai';
import { db } from '../db';
import { cards, cardSets } from '../../shared/schema';
import { ilike, or, eq } from 'drizzle-orm';

export const FREE_SCAN_LIMIT_PER_MONTH = 25;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

interface CardVisionResult {
  characterName: string | null;
  setName: string | null;
  subsetName: string | null;
  cardNumber: string | null;
  year: string | null;
  brand: string | null;
  variant: string | null;
}

export interface ScanMatch {
  cardId: number;
  name: string;
  setName: string;
  subsetName: string | null;
  cardNumber: string;
  year: number | null;
  imageUrl: string | null;
  confidence: number;
  matchReasons: string[];
}

export interface ScanResult {
  ocrText: string;
  parsed: CardVisionResult;
  matches: ScanMatch[];
  confidenceLevel: 'high' | 'medium' | 'low' | 'none';
}

async function identifyCardWithVision(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<CardVisionResult> {
  if (!openai) {
    console.warn('[Scan] OPENAI_API_KEY not set — vision unavailable');
    return { characterName: null, setName: null, subsetName: null, cardNumber: null, year: null, brand: null, variant: null };
  }

  const base64 = imageBuffer.toString('base64');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are a Marvel trading card expert. Analyze this card image carefully and return ONLY a JSON object with these fields:
{
  "characterName": "The character's name exactly as shown on the card (e.g. Spider-Man, Wolverine, Iron Man)",
  "setName": "The card set name (e.g. Marvel Masterpieces, Fleer Ultra X-Men, Upper Deck Series 1)",
  "subsetName": "Subset or parallel type if visible (e.g. Canvas, Gold Foil Signature, Printing Plate Black) or null",
  "cardNumber": "Card number only, no # symbol (e.g. 85, 12, PP-5) or null",
  "year": "4-digit year printed on the card or null",
  "brand": "Card manufacturer only (e.g. SkyBox, Upper Deck, Topps, Fleer, Impel) or null",
  "variant": "Variant or parallel description if different from subsetName, or null"
}
Return ONLY the JSON object. No explanation, no markdown.`,
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
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as CardVisionResult;
  } catch (err) {
    console.error('[Scan] Vision API error:', err);
  }

  return { characterName: null, setName: null, subsetName: null, cardNumber: null, year: null, brand: null, variant: null };
}

async function matchCards(vision: CardVisionResult): Promise<ScanMatch[]> {
  if (!vision.characterName && !vision.cardNumber && !vision.setName) return [];

  const conditions: ReturnType<typeof ilike>[] = [];

  if (vision.characterName) {
    conditions.push(ilike(cards.name, `%${vision.characterName}%`));
    // Also try first word only (e.g. "Spider" from "Spider-Man")
    const firstName = vision.characterName.split(/[-\s]/)[0];
    if (firstName.length > 3 && firstName !== vision.characterName) {
      conditions.push(ilike(cards.name, `%${firstName}%`));
    }
  }

  if (vision.cardNumber) {
    conditions.push(ilike(cards.cardNumber, vision.cardNumber));
    conditions.push(ilike(cards.cardNumber, `%${vision.cardNumber}`));
    conditions.push(ilike(cards.cardNumber, `${vision.cardNumber}%`));
  }

  if (vision.setName) {
    // Try partial set name words for better matching
    const setWords = vision.setName.split(' ').filter(w => w.length > 4);
    for (const word of setWords.slice(0, 3)) {
      conditions.push(ilike(cardSets.name, `%${word}%`));
    }
  }

  if (conditions.length === 0) return [];

  const results = await db
    .select({
      id: cards.id,
      name: cards.name,
      cardNumber: cards.cardNumber,
      frontImageUrl: cards.frontImageUrl,
      variation: cards.variation,
      setName: cardSets.name,
      setYear: cardSets.year,
    })
    .from(cards)
    .innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .where(or(...conditions))
    .limit(60);

  const scored = results.map(r => {
    let score = 0;
    const reasons: string[] = [];

    // Card number — strong signal
    if (vision.cardNumber) {
      const vNum = vision.cardNumber.replace(/\D/g, '');
      const rNum = (r.cardNumber || '').replace(/\D/g, '');
      if (vNum && rNum === vNum) { score += 50; reasons.push('card number'); }
    }

    // Character name — strong signal
    if (vision.characterName) {
      const vName = vision.characterName.toLowerCase();
      const rName = (r.name || '').toLowerCase();
      if (rName.includes(vName) || vName.includes(rName)) {
        score += 40; reasons.push('character name');
      } else {
        // Partial match on first word
        const vFirst = vName.split(/[-\s]/)[0];
        if (rName.includes(vFirst) && vFirst.length > 3) { score += 15; reasons.push('character name (partial)'); }
      }
    }

    // Year — good tiebreaker
    if (vision.year && r.setYear?.toString() === vision.year) {
      score += 25; reasons.push('year');
    }

    // Set name — good signal
    if (vision.setName) {
      const vSet = vision.setName.toLowerCase();
      const rSet = (r.setName || '').toLowerCase();
      if (rSet.includes(vSet) || vSet.includes(rSet)) {
        score += 30; reasons.push('set name');
      } else {
        // Partial set word match
        const vWords = vSet.split(' ').filter((w: string) => w.length > 4);
        const matchedWords = vWords.filter((w: string) => rSet.includes(w));
        if (matchedWords.length > 0) { score += matchedWords.length * 8; reasons.push('set name (partial)'); }
      }
    }

    // Brand in set name
    if (vision.brand) {
      const vBrand = vision.brand.toLowerCase();
      if ((r.setName || '').toLowerCase().includes(vBrand)) {
        score += 10; reasons.push('brand');
      }
    }

    return {
      cardId: r.id,
      name: r.name || '',
      setName: r.setName || '',
      subsetName: r.variation || null,
      cardNumber: r.cardNumber || '',
      year: r.setYear || null,
      imageUrl: r.frontImageUrl || null,
      confidence: score,
      matchReasons: [...new Set(reasons)],
    };
  });

  return scored
    .filter(m => m.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function getConfidenceLevel(matches: ScanMatch[]): 'high' | 'medium' | 'low' | 'none' {
  if (matches.length === 0) return 'none';
  const top = matches[0].confidence;
  if (top >= 90) return 'high';
  if (top >= 50) return 'medium';
  if (top > 0) return 'low';
  return 'none';
}

export async function scanCard(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<ScanResult> {
  const vision = await identifyCardWithVision(imageBuffer, mimeType);

  console.log('[Scan] Vision result:', JSON.stringify(vision));

  const matches = await matchCards(vision);
  const confidenceLevel = getConfidenceLevel(matches);

  const ocrText = [
    vision.characterName,
    vision.setName,
    vision.year,
    vision.cardNumber ? `#${vision.cardNumber}` : null,
    vision.variant || vision.subsetName,
  ].filter(Boolean).join(' ');

  return { ocrText, parsed: vision, matches, confidenceLevel };
}

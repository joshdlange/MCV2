import { db } from '../db';
import { cards, cardSets } from '../../shared/schema';
import { ilike, or, eq } from 'drizzle-orm';

interface ParsedOcrText {
  cardNumber: string | null;
  year: string | null;
  keywords: string[];
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
  parsed: ParsedOcrText;
  matches: ScanMatch[];
  confidenceLevel: 'high' | 'medium' | 'low' | 'none';
}

async function extractTextFromImage(imageBuffer: Buffer): Promise<string> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      logger: () => {},
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OCR timeout after 20s')), 20000)
    );
    const ocrPromise = worker.recognize(imageBuffer);
    const result = await Promise.race([ocrPromise, timeoutPromise]) as Awaited<typeof ocrPromise>;
    await worker.terminate();
    return result.data.text;
  } catch (err) {
    console.warn('[Scan] OCR failed or timed out:', (err as Error).message);
    return '';
  }
}

function parseOcrText(text: string): ParsedOcrText {
  if (!text.trim()) return { cardNumber: null, year: null, keywords: [] };

  const cardNumberMatch = text.match(/#?(\d{1,4}[A-Za-z]?(?:\/\d{1,4})?)/);
  const cardNumber = cardNumberMatch ? cardNumberMatch[1] : null;

  const yearMatch = text.match(/\b(19[6-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;

  const stopwords = new Set([
    'the', 'and', 'for', 'from', 'with', 'that', 'this', 'card', 'cards',
    'upper', 'deck', 'skybox', 'fleer', 'impel', 'marvel', 'comics',
    'trading', 'series', 'base', 'set', 'parallel', 'insert', 'foil',
  ]);

  const keywords = text
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^-+|-+$/g, '').toLowerCase())
    .filter(w => w.length >= 3 && !stopwords.has(w) && !/^\d+$/.test(w))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 10);

  return { cardNumber, year, keywords };
}

async function matchCards(parsed: ParsedOcrText): Promise<ScanMatch[]> {
  const conditions: ReturnType<typeof ilike>[] = [];

  if (parsed.cardNumber) {
    conditions.push(ilike(cards.cardNumber, `%${parsed.cardNumber}%`));
  }
  for (const kw of parsed.keywords.slice(0, 5)) {
    conditions.push(ilike(cards.name, `%${kw}%`));
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
    .limit(30);

  const scored = results.map(r => {
    let score = 0;
    const reasons: string[] = [];

    if (parsed.cardNumber) {
      const normalized = parsed.cardNumber.replace(/\D/g, '');
      const cardNum = (r.cardNumber || '').replace(/\D/g, '');
      if (cardNum && cardNum === normalized) {
        score += 60;
        reasons.push('card number');
      }
    }

    if (parsed.year && r.setYear?.toString() === parsed.year) {
      score += 20;
      reasons.push('year');
    }

    for (const kw of parsed.keywords) {
      if ((r.name || '').toLowerCase().includes(kw)) {
        score += 30;
        reasons.push('character name');
        break;
      }
    }

    for (const kw of parsed.keywords) {
      if ((r.setName || '').toLowerCase().includes(kw)) {
        score += 20;
        reasons.push('set name');
        break;
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
  if (top >= 80) return 'high';
  if (top >= 40) return 'medium';
  if (top > 0) return 'low';
  return 'none';
}

export async function scanCard(imageBuffer: Buffer): Promise<ScanResult> {
  const ocrText = await extractTextFromImage(imageBuffer);
  const parsed = parseOcrText(ocrText);
  const matches = await matchCards(parsed);
  const confidenceLevel = getConfidenceLevel(matches);
  return { ocrText, parsed, matches, confidenceLevel };
}

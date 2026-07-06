// ── Scan to Add matching engine ────────────────────────────────────────────
// Normalization helpers, alias dictionary, staged candidate retrieval, and
// scoring used to turn noisy vision/OCR output into ranked card matches.

import { db } from '../db';
import { cards, cardSets } from '../../shared/schema';
import { ilike, or, eq, inArray } from 'drizzle-orm';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedScan {
  characterName: string | null;
  setName: string | null;
  subsetName: string | null;
  cardNumber: string | null;
  year: string | null;
  brand: string | null;
  variant: string | null;
  copyrightLine: string | null;
  serialIndicator: string | null;
  keywords: string[];
}

export interface ScanCandidateRow {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  variation: string | null;
  isInsert: boolean;
  setName: string;
  setYear: number;
}

export interface ScoredMatch {
  cardId: number;
  name: string;
  setName: string;
  subsetName: string | null;
  cardNumber: string;
  year: number | null;
  imageUrl: string | null;
  confidence: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'none';
  matchReasons: string[];
}

// ── Normalization helpers ────────────────────────────────────────────────────

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^\w\s-]/g, ' ') // strip punctuation except hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a card number: strip "#"/"No."/leading zeros, uppercase letters,
 * standardize hyphen spacing (e.g. "MM 23" -> "MM-23", "No. 23" -> "23").
 */
export function normalizeCardNumber(input: string | null | undefined): string {
  if (!input) return '';
  let s = input.trim().toUpperCase();
  s = s.replace(/^NO\.?\s*/i, '');
  s = s.replace(/^#\s*/, '');
  s = s.replace(/\s+/g, ' ').trim();
  // "MM 23" -> "MM-23" (letters, space, digits)
  s = s.replace(/^([A-Z]{1,4})\s+(\d+)$/, '$1-$2');
  // Collapse multiple hyphens/spaces around hyphen: "MM - 23" -> "MM-23"
  s = s.replace(/\s*-\s*/g, '-');
  // Strip leading zeros on purely numeric card numbers ("007" -> "7") but
  // keep alphanumeric prefixed numbers untouched (e.g. "AV-05" stays as-is
  // since parallels often rely on the exact printed form).
  if (/^\d+$/.test(s)) {
    s = String(parseInt(s, 10));
  }
  return s;
}

/** Digits-only version of a card number, useful as a loose fallback signal. */
export function cardNumberDigits(input: string | null | undefined): string {
  return (input || '').replace(/\D/g, '');
}

// Common Marvel set name aliases -> canonical form. Keys and values are
// pre-normalized (lowercase, no punctuation) for direct comparison.
const SET_ALIASES: Record<string, string> = {
  'marvel metal universe': 'metal universe',
  'metal': 'metal universe',
  'marvel masterpieces': 'masterpieces',
  'mastepieces': 'masterpieces', // common OCR typo
  'fleer ultra': 'ultra',
  'fleer uitra': 'ultra', // OCR l->i mistake
  'flair marvel': 'flair',
  'marvel flair': 'flair',
  'marvel annual': 'annual',
  'marvel platinum': 'platinum',
  'ud': 'upper deck',
  'marvel universe': 'universe',
  'skybox marvel universe': 'universe',
};

/** Apply known set-name aliases/OCR-typo corrections after normalization. */
export function resolveSetAlias(normalizedSetName: string): string {
  if (!normalizedSetName) return normalizedSetName;
  // Fix common OCR letter confusions before alias lookup.
  const corrected = normalizedSetName
    .replace(/\bmetai\b/g, 'metal')
    .replace(/\buitra\b/g, 'ultra')
    .replace(/\bmastepieces\b/g, 'masterpieces');
  return SET_ALIASES[corrected] || corrected;
}

/** Extract a compact set of meaningful keywords (length > 3) from free text. */
export function extractKeywords(text: string | null | undefined): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  return [...new Set(norm.split(' ').filter(w => w.length > 3))];
}

// ── Field extraction helpers (used to enrich raw OCR text) ──────────────────

const CARD_NUMBER_PATTERNS = [
  /#\s?\d+/g, // #12
  /\bno\.?\s?\d+\b/gi, // No. 12
  /\b\d{1,3}\s?\/\s?\d{2,4}\b/g, // 12/100
  /\b[A-Z]{1,4}-\d{1,3}\b/g, // MM-23, AV-17, SP-5
  /\b[A-Z]{1,4}\s\d{1,3}\b/g, // MM 23
];

const YEAR_PATTERN = /\b(19[5-9]\d|20[0-4]\d)\b/g;

const KNOWN_SET_NAMES = [
  'metal universe', 'marvel metal universe', 'fleer ultra', 'marvel masterpieces',
  'flair', 'annual', 'platinum', 'upper deck', 'marvel universe', 'skybox',
  'impel', 'topps', 'panini', 'chrome',
];

/** Best-effort extraction of structured hints from raw OCR text. */
export function extractHintsFromText(raw: string): {
  cardNumberCandidates: string[];
  yearCandidates: string[];
  setNameCandidates: string[];
} {
  const cardNumberCandidates = new Set<string>();
  for (const pattern of CARD_NUMBER_PATTERNS) {
    const found = raw.match(pattern) || [];
    found.forEach(f => cardNumberCandidates.add(normalizeCardNumber(f)));
  }

  const yearCandidates = [...new Set((raw.match(YEAR_PATTERN) || []))];

  const lowerRaw = normalizeText(raw);
  const setNameCandidates = KNOWN_SET_NAMES.filter(name => lowerRaw.includes(name));

  return {
    cardNumberCandidates: [...cardNumberCandidates].filter(Boolean),
    yearCandidates,
    setNameCandidates,
  };
}

// ── Staged candidate retrieval ───────────────────────────────────────────────

/**
 * Retrieve candidate rows using staged narrowing instead of one giant fuzzy
 * search: prioritize card number > set name > year > character name, then
 * merge/dedupe. This keeps the query set small and relevant.
 */
async function retrieveCandidates(parsed: ParsedScan): Promise<ScanCandidateRow[]> {
  const stageResults: ScanCandidateRow[][] = [];

  const baseSelect = () =>
    db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        frontImageUrl: cards.frontImageUrl,
        variation: cards.variation,
        isInsert: cards.isInsert,
        setName: cardSets.name,
        setYear: cardSets.year,
      })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id));

  // Stage 1: card number (strongest signal — narrow first if present)
  if (parsed.cardNumber) {
    const normNum = normalizeCardNumber(parsed.cardNumber);
    const digitsNum = cardNumberDigits(parsed.cardNumber);
    const conditions = [ilike(cards.cardNumber, normNum)];
    if (digitsNum) {
      conditions.push(ilike(cards.cardNumber, `%${digitsNum}`));
      conditions.push(ilike(cards.cardNumber, `${digitsNum}%`));
    }
    const rows = await baseSelect().where(or(...conditions)).orderBy(cards.id).limit(80);
    stageResults.push(rows as ScanCandidateRow[]);
  }

  // Stage 2: set name (alias-resolved) — search sets first, then join cards
  if (parsed.setName) {
    const resolvedSet = resolveSetAlias(normalizeText(parsed.setName));
    const setWords = resolvedSet.split(' ').filter(w => w.length > 3);
    if (setWords.length > 0) {
      const setConditions = setWords.slice(0, 4).map(w => ilike(cardSets.name, `%${w}%`));
      const rows = await baseSelect().where(or(...setConditions)).orderBy(cards.id).limit(80);
      stageResults.push(rows as ScanCandidateRow[]);
    }
  }

  // Stage 3: character/card name
  if (parsed.characterName) {
    const nameConditions = [ilike(cards.name, `%${parsed.characterName}%`)];
    const firstWord = parsed.characterName.split(/[-\s]/)[0];
    if (firstWord.length > 3 && firstWord !== parsed.characterName) {
      nameConditions.push(ilike(cards.name, `%${firstWord}%`));
    }
    const rows = await baseSelect().where(or(...nameConditions)).orderBy(cards.id).limit(80);
    stageResults.push(rows as ScanCandidateRow[]);
  }

  // Stage 4: keyword fallback if nothing structured was found at all
  if (stageResults.length === 0 && parsed.keywords.length > 0) {
    const kwConditions = parsed.keywords.slice(0, 5).map(kw => ilike(cards.name, `%${kw}%`));
    if (kwConditions.length > 0) {
      const rows = await baseSelect().where(or(...kwConditions)).orderBy(cards.id).limit(80);
      stageResults.push(rows as ScanCandidateRow[]);
    }
  }

  // Merge + dedupe by card id
  const merged = new Map<number, ScanCandidateRow>();
  for (const stage of stageResults) {
    for (const row of stage) {
      if (!merged.has(row.id)) merged.set(row.id, row);
    }
  }
  return [...merged.values()];
}

// ── Scoring ───────────────────────────────────────────────────────────────

function scoreCandidate(row: ScanCandidateRow, parsed: ParsedScan): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Card number — exact normalized match is the strongest single signal.
  if (parsed.cardNumber) {
    const parsedNorm = normalizeCardNumber(parsed.cardNumber);
    const rowNorm = normalizeCardNumber(row.cardNumber);
    if (parsedNorm && rowNorm === parsedNorm) {
      score += 50;
      reasons.push(`Exact card number match (${rowNorm})`);
    } else {
      const parsedDigits = cardNumberDigits(parsed.cardNumber);
      const rowDigits = cardNumberDigits(row.cardNumber);
      if (parsedDigits && rowDigits === parsedDigits) {
        score += 30;
        reasons.push(`Card number digits match (${rowDigits})`);
      }
    }
  }

  // Year
  if (parsed.year && row.setYear?.toString() === parsed.year) {
    score += 25;
    reasons.push(`Year matched ${parsed.year}`);
  }

  // Set name — alias resolved comparison
  if (parsed.setName) {
    const parsedSet = resolveSetAlias(normalizeText(parsed.setName));
    const rowSet = resolveSetAlias(normalizeText(row.setName));
    if (parsedSet && (rowSet === parsedSet || rowSet.includes(parsedSet) || parsedSet.includes(rowSet))) {
      score += 30;
      reasons.push(`Set alias matched "${row.setName}"`);
    } else {
      const parsedWords = parsedSet.split(' ').filter(w => w.length > 3);
      const matchedWords = parsedWords.filter(w => rowSet.includes(w));
      if (matchedWords.length > 0) {
        score += matchedWords.length * 8;
        reasons.push(`Set name partially matched (${matchedWords.join(', ')})`);
      }
    }
  }

  // Subset/insert name
  if (parsed.subsetName && row.variation) {
    const parsedSub = normalizeText(parsed.subsetName);
    const rowSub = normalizeText(row.variation);
    if (parsedSub && (rowSub.includes(parsedSub) || parsedSub.includes(rowSub))) {
      score += 20;
      reasons.push(`Subset/insert matched "${row.variation}"`);
    }
  }

  // Character/card name — strong signal, with partial fallback
  if (parsed.characterName) {
    const parsedName = normalizeText(parsed.characterName);
    const rowName = normalizeText(row.name);
    if (rowName.includes(parsedName) || parsedName.includes(rowName)) {
      score += 40;
      reasons.push(`Character/card name matched "${row.name}"`);
    } else {
      const firstWord = parsedName.split(' ')[0];
      if (firstWord.length > 3 && rowName.includes(firstWord)) {
        score += 15;
        reasons.push(`Character name partially matched ("${firstWord}")`);
      }
    }
  }

  // Brand — weak tiebreaker
  if (parsed.brand) {
    const brand = normalizeText(parsed.brand);
    if (brand && normalizeText(row.setName).includes(brand)) {
      score += 10;
      reasons.push(`Brand "${parsed.brand}" found in set name`);
    }
  }

  // Fuzzy text similarity fallback using keywords extracted from raw OCR
  if (parsed.keywords.length > 0) {
    const rowText = normalizeText(`${row.name} ${row.setName} ${row.variation || ''}`);
    const hitCount = parsed.keywords.filter(kw => rowText.includes(kw)).length;
    if (hitCount > 0) {
      score += hitCount * 4;
      reasons.push(`${hitCount} OCR keyword${hitCount > 1 ? 's' : ''} matched`);
    }
  }

  return { score, reasons: [...new Set(reasons)] };
}

export function getConfidenceLevel(topScore: number): 'high' | 'medium' | 'low' | 'none' {
  if (topScore >= 85) return 'high';
  if (topScore >= 45) return 'medium';
  if (topScore > 0) return 'low';
  return 'none';
}

/**
 * Main entry point: given parsed OCR/vision fields, retrieve and score
 * candidates, returning the top matches (not just one) with human-readable
 * match reasons for the debug panel / UX.
 */
export async function matchCandidates(parsed: ParsedScan): Promise<ScoredMatch[]> {
  const hasSignal = parsed.characterName || parsed.cardNumber || parsed.setName || parsed.keywords.length > 0;
  if (!hasSignal) return [];

  const candidates = await retrieveCandidates(parsed);
  if (candidates.length === 0) return [];

  const scored = candidates.map(row => {
    const { score, reasons } = scoreCandidate(row, parsed);
    return {
      cardId: row.id,
      name: row.name,
      setName: row.setName,
      subsetName: row.variation || null,
      cardNumber: row.cardNumber,
      year: row.setYear ?? null,
      imageUrl: row.frontImageUrl || null,
      confidence: score,
      confidenceLevel: getConfidenceLevel(score),
      matchReasons: reasons,
    };
  });

  return scored
    .filter(m => m.confidence > 0)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // Deterministic tiebreakers: more corroborating reasons wins, then
      // lower cardId (older/more canonical entries) so results are stable
      // across runs instead of depending on unordered DB row order.
      if (b.matchReasons.length !== a.matchReasons.length) {
        return b.matchReasons.length - a.matchReasons.length;
      }
      return a.cardId - b.cardId;
    })
    .slice(0, 5);
}

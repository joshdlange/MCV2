// ── Scan to Add matching engine ────────────────────────────────────────────
// Normalization helpers, alias dictionary, staged candidate retrieval, and
// scoring used to turn noisy vision/OCR output into ranked card matches.

import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { ilike, or, eq, and, inArray, isNull, sql, type SQL } from 'drizzle-orm';

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

/** Safe boundary for historical matcher inputs as well as fresh vision results. */
export function sanitizeParsedScan(parsed: ParsedScan): ParsedScan {
  return {
    characterName: normalizeScanField(parsed.characterName),
    setName: normalizeScanField(parsed.setName),
    subsetName: normalizeScanField(parsed.subsetName),
    cardNumber: normalizeScanField(parsed.cardNumber),
    year: normalizeScanField(parsed.year),
    brand: normalizeScanField(parsed.brand),
    variant: normalizeScanField(parsed.variant),
    copyrightLine: normalizeScanField(parsed.copyrightLine),
    serialIndicator: normalizeScanField(parsed.serialIndicator),
    keywords: [...new Set((Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .flatMap(value => extractKeywords(value)))],
  };
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
  /** Cards in insert subsets can belong to a separate card_sets row. */
  mainSetName?: string | null;
  isInsertSubset?: boolean;
}

export interface ScoredMatch {
  setId?: number;
  mainSetId?: number | null;
  mainSetName?: string | null;
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
  retrievalSource?: 'image' | 'image-family' | 'metadata';
  imageSimilarity?: number;
  familyKey?: string;
  metadataConflicts?: string[];
}

// ── Normalization helpers ────────────────────────────────────────────────────

/** Vision APIs sometimes return missing fields as quoted placeholder words. */
export function normalizeScanField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !/^(?:null|undefined|none)$/i.test(trimmed) ? trimmed : null;
}

/** Remove only whole placeholder tokens, never substrings of real names (Knull, Nullifier). */
export function normalizeOcrText(value: unknown): string {
  const text = normalizeScanField(value);
  return text ? text.replace(/\b(?:null|undefined|none)\b/gi, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  const text = normalizeOcrText(input);
  if (!text) return '';
  return text
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
  const field = normalizeScanField(input);
  if (!field) return '';
  let s = field.toUpperCase();
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

/** Digits-only version of a card number, for candidate retrieval only (not identity). */
export function cardNumberDigits(input: string | null | undefined): string {
  return (normalizeScanField(input) || '').replace(/\D/g, '');
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
  /#\s*[A-Z]{0,8}-?\d{1,5}\b/gi, // #12, #MM-23
  /\bno\.?\s*[A-Z]{0,8}-?\d{1,5}\b/gi, // No. 12
  /\b[A-Z]{1,8}-\d{1,5}\b/g, // explicitly printed MM-23, AV-17
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
  const cleanRaw = normalizeOcrText(raw);
  const cardNumberCandidates = new Set<string>();
  for (const pattern of CARD_NUMBER_PATTERNS) {
    const found = cleanRaw.match(pattern) || [];
    found.forEach(f => cardNumberCandidates.add(normalizeCardNumber(f)));
  }

  const yearCandidates = [...new Set((cleanRaw.match(YEAR_PATTERN) || []))];

  const lowerRaw = normalizeText(cleanRaw);
  const setNameCandidates = KNOWN_SET_NAMES.filter(name => lowerRaw.includes(name));

  return {
    cardNumberCandidates: [...cardNumberCandidates].filter(Boolean),
    yearCandidates,
    setNameCandidates,
  };
}

// ── Staged candidate retrieval ───────────────────────────────────────────────

const likeLiteral = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/**
 * Search intersections first. A common character, set, or number alone can
 * have hundreds of rows, so limiting those independent queries by ID loses
 * the actual card before scoring even begins.
 */
export async function retrieveCandidates(
  parsed: ParsedScan,
  fetchRows: (condition: SQL, limit: number) => Promise<ScanCandidateRow[]> = async (condition, limit) =>
    db.select({
      id: cards.id,
      name: cards.name,
      cardNumber: cards.cardNumber,
      frontImageUrl: cards.frontImageUrl,
      variation: cards.variation,
      isInsert: cards.isInsert,
      setName: cardSets.name,
      setYear: cardSets.year,
      mainSetName: mainSets.name,
      isInsertSubset: cardSets.isInsertSubset,
    }).from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id))
      .where(condition).orderBy(cards.id).limit(limit),
): Promise<ScanCandidateRow[]> {
  parsed = sanitizeParsedScan(parsed);
  const merged = new Map<number, ScanCandidateRow>();

  const number = parsed.cardNumber ? normalizeCardNumber(parsed.cardNumber) : '';
  // Exact normalized numeric identity without converting a prefixed number
  // (AV-1) to plain 1. This handles stored 001, #001 and No. 001 alike.
  const strippedNumber = sql<string>`btrim(regexp_replace(upper(btrim(${cards.cardNumber})), '^(NO\\.?[[:space:]]*|#[[:space:]]*)', ''))`;
  const normalizedStoredNumber = sql<string>`case when ${strippedNumber} ~ '^[0-9]+$'
    then coalesce(nullif(ltrim(${strippedNumber}, '0'), ''), '0')
    else regexp_replace(regexp_replace(${strippedNumber}, '[[:space:]]*-[[:space:]]*', '-', 'g'),
      '^([A-Z]{1,4})[[:space:]]+([0-9]+)$', ${'\\1-\\2'}) end`;
  const numberCondition = number
    ? or(
        ilike(cards.cardNumber, likeLiteral(number)),
        ilike(cards.cardNumber, likeLiteral(parsed.cardNumber!.trim().replace(/^(?:NO\.?\s*|#\s*)/i, ''))),
        eq(normalizedStoredNumber, number),
      )
    : undefined;
  const setWords = resolveSetAlias(normalizeText(parsed.setName)).split(' ').filter(w => w.length > 3);
  const setCondition = setWords.length
    ? or(...setWords.map(w => or(
        ilike(cardSets.name, `%${likeLiteral(w)}%`),
        ilike(mainSets.name, `%${likeLiteral(w)}%`),
      )))
    : undefined;
  const name = normalizeText(parsed.characterName);
  // Wildcards between words account for printed hyphens and punctuation:
  // Spider-Man, Spider Man and Spider/Man are all retrieval candidates.
  const nameCondition = name ? ilike(cards.name, `%${name.split(/[\s-]+/).filter(Boolean).map(likeLiteral).join('%')}%`) : undefined;
  const year = parsed.year && /^\d{4}$/.test(parsed.year) ? eq(cardSets.year, Number(parsed.year)) : undefined;
  const subset = normalizeText(parsed.subsetName || parsed.variant);
  const subsetCondition = subset.length > 2
    ? or(ilike(cards.variation, `%${likeLiteral(subset)}%`), ilike(cardSets.name, `%${likeLiteral(subset)}%`))
    : undefined;

  const probes = [
    [numberCondition, setCondition, year, nameCondition, subsetCondition],
    [numberCondition, setCondition, year, nameCondition],
    [numberCondition, setCondition, year],
    [numberCondition, setCondition, nameCondition],
    [numberCondition, year, nameCondition],
    [setCondition, year, nameCondition, subsetCondition],
    [setCondition, year, nameCondition],
    [numberCondition, setCondition],
    [numberCondition, year],
    [numberCondition, nameCondition],
    [setCondition, nameCondition],
    [numberCondition],
    [nameCondition, year],
    [setCondition, year],
    [nameCondition],
    [setCondition],
  ];
  const fallbackKey = numberCondition ? 'number' : nameCondition ? 'name' : setCondition ? 'set' : '';
  const seenProbes = new Set<string>();
  let foundSelective = false;
  for (const probe of probes) {
    const conditions = probe.filter((c): c is NonNullable<typeof c> => !!c);
    if (!conditions.length) continue;
    const key = conditions.map((c) =>
      c === numberCondition ? 'number' : c === setCondition ? 'set' :
      c === nameCondition ? 'name' : c === year ? 'year' : 'subset'
    ).sort().join('|');
    if (seenProbes.has(key)) continue;
    seenProbes.add(key);
    // Once an intersection finds a candidate, only one broad escape hatch is
    // needed to find alternatives when the OCR supplied a wrong extra hint.
    if (foundSelective && key !== fallbackKey) continue;
    const rows = await fetchRows(and(...conditions)!, 300);
    for (const row of rows) merged.set(row.id, row);
    if (rows.length && key !== fallbackKey) foundSelective = true;
    if (key === fallbackKey && merged.size) break;
    // Broad single-field searches are a last resort; never let them crowd out
    // the results of more selective intersections.
    if (merged.size >= 600) break;
  }
  if (!merged.size && parsed.keywords.length) {
    const words = parsed.keywords.map(normalizeText).filter(w => w.length > 3).slice(0, 5);
    if (words.length) {
      const rows = await fetchRows(or(...words.map(w => ilike(cards.name, `%${likeLiteral(w)}%`)))!, 100);
      for (const row of rows) merged.set(row.id, row);
    }
  }
  return [...merged.values()];
}

// ── Scoring ───────────────────────────────────────────────────────────────

export function scoreCandidate(row: ScanCandidateRow, parsed: ParsedScan): { score: number; reasons: string[]; exactNumber: boolean; identitySignals: number } {
  parsed = sanitizeParsedScan(parsed);
  let score = 0;
  const reasons: string[] = [];
  let exactNumber = false;
  let identitySignals = 0;

  // Card number — exact normalized match is the strongest single signal.
  if (parsed.cardNumber) {
    const parsedNorm = normalizeCardNumber(parsed.cardNumber);
    const rowNorm = normalizeCardNumber(row.cardNumber);
    if (parsedNorm && rowNorm === parsedNorm) {
      score += 50;
      exactNumber = true;
      reasons.push(`Exact card number match (${rowNorm})`);
    } else if (parsedNorm) {
      score -= 45;
      reasons.push(`Card number conflicts (${row.cardNumber})`);
    }
  }

  // Year
  if (parsed.year && row.setYear?.toString() === parsed.year) {
    score += 25;
    reasons.push(`Year matched ${parsed.year}`);
  } else if (parsed.year && /^\d{4}$/.test(parsed.year)) {
    score -= 20;
    reasons.push(`Year conflicts (${row.setYear})`);
  }

  // Set name — alias resolved comparison
  if (parsed.setName) {
    const parsedSet = resolveSetAlias(normalizeText(parsed.setName));
    const rowSet = resolveSetAlias(normalizeText(row.mainSetName || row.setName));
    const rowSubset = normalizeText(row.setName);
    if (parsedSet && (rowSet === parsedSet || rowSet.includes(parsedSet) || parsedSet.includes(rowSet) || rowSubset.includes(parsedSet))) {
      score += 30;
      identitySignals++;
      reasons.push(`Set alias matched "${row.setName}"`);
    } else {
      const parsedWords = parsedSet.split(' ').filter(w => w.length > 3 && w !== 'marvel');
      const matchedWords = parsedWords.filter(w => rowSet.split(' ').includes(w) || rowSubset.split(' ').includes(w));
      if (matchedWords.length > 0) {
        score += Math.min(matchedWords.length * 8, 16);
        reasons.push(`Set name partially matched (${matchedWords.join(', ')})`);
      } else if (parsedWords.length) {
        score -= 25;
        reasons.push(`Set conflicts (${row.setName})`);
      }
    }
  }

  // Subsets can be a separate set row, not just a card variation.
  for (const hint of [...new Set([parsed.subsetName, parsed.variant].map(normalizeText).filter(Boolean))]) {
    const rowVariation = normalizeText(row.variation);
    const rowSubset = row.isInsertSubset ? normalizeText(row.setName) : '';
    if ([rowVariation, rowSubset].some(value => value && (value.includes(hint) || (hint.length > 4 && hint.includes(value))))) {
      score += 20;
      identitySignals++;
      reasons.push(`Subset/variant matched "${row.variation || row.setName}"`);
    } else {
      score -= 25;
      reasons.push(`Subset/variant conflicts (${row.variation || (row.isInsertSubset ? row.setName : 'base')})`);
    }
  }

  // Character/card name — strong signal, with partial fallback
  if (parsed.characterName) {
    const parsedName = normalizeText(parsed.characterName).replace(/-/g, ' ');
    const rowName = normalizeText(row.name).replace(/-/g, ' ');
    if (parsedName && rowName && (rowName.includes(parsedName) || parsedName.includes(rowName))) {
      score += 40;
      identitySignals++;
      reasons.push(`Character/card name matched "${row.name}"`);
    } else {
      const firstWord = parsedName.split(' ')[0];
      if (firstWord.length > 3 && rowName.includes(firstWord)) {
        score += 15;
        reasons.push(`Character name partially matched ("${firstWord}")`);
      } else if (parsedName && rowName) {
        score -= 25;
        reasons.push(`Character/card name conflicts (${row.name})`);
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
      score += Math.min(hitCount * 4, 12);
      reasons.push(`${hitCount} OCR keyword${hitCount > 1 ? 's' : ''} matched`);
    }
  }

  return { score, reasons: [...new Set(reasons)], exactNumber, identitySignals };
}

export function getConfidenceLevel(topScore: number): 'high' | 'medium' | 'low' | 'none' {
  if (topScore >= 85) return 'high';
  if (topScore >= 45) return 'medium';
  if (topScore > 0) return 'low';
  return 'none';
}

/** Pure ranking step, shared with deterministic tests and the DB-backed matcher. */
export function rankScanCandidates(candidates: ScanCandidateRow[], parsed: ParsedScan): ScoredMatch[] {
  parsed = sanitizeParsedScan(parsed);
  const scored = candidates.map(row => {
    const { score, reasons, exactNumber, identitySignals } = scoreCandidate(row, parsed);
    // A familiar character alone is not a unique print. Even an exact number
    // must have independent set/subset/name corroboration to be "high".
    const highEligible = exactNumber && identitySignals >= 2 &&
      !reasons.some(reason => reason.includes('conflicts')) &&
      (!!parsed.setName || !!parsed.subsetName || !!parsed.variant);
    const level = getConfidenceLevel(score);
    return {
      cardId: row.id,
      name: row.name,
      setName: row.setName,
      subsetName: row.variation || (row.isInsertSubset ? row.setName : null),
      cardNumber: row.cardNumber,
      year: row.setYear ?? null,
      imageUrl: row.frontImageUrl || null,
      confidence: score,
      confidenceLevel: level === 'high' && !highEligible ? 'medium' as const : level,
      matchReasons: reasons,
    };
  }).filter(m => m.confidence > 0).sort((a, b) =>
    b.confidence - a.confidence || b.matchReasons.length - a.matchReasons.length || a.cardId - b.cardId
  );

  // A near-tie is not an exact identification, even when the numeric score
  // clears the high threshold. Preserve scores and ranked alternatives.
  if (scored.length > 1 && scored[0].confidence - scored[1].confidence < 15) {
    for (const match of scored) {
      if (scored[0].confidence - match.confidence >= 15) break;
      if (match.confidenceLevel === 'high') match.confidenceLevel = 'medium';
    }
  }
  return scored.slice(0, 5);
}

/**
 * Main entry point: given parsed OCR/vision fields, retrieve and score
 * candidates, returning the top matches (not just one) with human-readable
 * match reasons for the debug panel / UX.
 */
export async function matchCandidates(parsed: ParsedScan): Promise<ScoredMatch[]> {
  parsed = sanitizeParsedScan(parsed);
  const hasSignal = parsed.characterName || parsed.cardNumber || parsed.setName || parsed.keywords.length > 0;
  if (!hasSignal) return [];

  const candidates = await retrieveCandidates(parsed);
  if (candidates.length === 0) return [];

  return rankScanCandidates(candidates, parsed);
}

/** Family identity is deliberately independent of extracted scan text. */
export function scanFamilyKey(row: ScanCandidateRow): string {
  return [
    resolveSetAlias(normalizeText(row.mainSetName || row.setName)),
    row.setYear, normalizeText(row.name), normalizeCardNumber(row.cardNumber),
  ].join('|');
}

/** Fetch image hits directly by ID, then retain checklist-family alternatives.
 * No OCR predicate is allowed to filter these rows, including negative hints.
 */
export async function retrieveImageCandidateRows(cardIds: number[]): Promise<ScanCandidateRow[]> {
  if (!cardIds.length) return [];
  const selectRows = (condition: SQL) => db.select({
    id: cards.id, name: cards.name, cardNumber: cards.cardNumber,
    frontImageUrl: cards.frontImageUrl, variation: cards.variation,
    isInsert: cards.isInsert, setName: cardSets.name, setYear: cardSets.year,
    mainSetName: mainSets.name, isInsertSubset: cardSets.isInsertSubset,
  }).from(cards).innerJoin(cardSets, eq(cards.setId, cardSets.id))
    .leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id)).where(and(
      condition, isNull(cards.archivedAt), isNull(cardSets.archivedAt), eq(cardSets.isActive, true),
      or(isNull(mainSets.id), and(isNull(mainSets.archivedAt), eq(mainSets.isActive, true))),
    ));
  const hits = await selectRows(inArray(cards.id, [...new Set(cardIds)]));
  if (!hits.length) return [];
  const families = [...new Map(hits.map(row => [scanFamilyKey(row), row])).values()];
  const relatives = await selectRows(or(...families.map(row => and(
    eq(cards.name, row.name), eq(cards.cardNumber, row.cardNumber),
    eq(cardSets.year, row.setYear),
    row.mainSetName ? eq(mainSets.name, row.mainSetName) : eq(cardSets.name, row.setName),
  )))!);
  return [...new Map([...hits, ...relatives].map(row => [row.id, row])).values()];
}

/** Image similarity drives retrieval/rank; text only corroborates or flags it.
 * Scores are ordering heuristics, never calibrated probabilities.
 */
export function rankImageCandidates(
  rows: ScanCandidateRow[],
  imageHits: { cardId: number; similarity: number }[],
  parsed: ParsedScan,
  metadataMatches: ScoredMatch[] = [],
): ScoredMatch[] {
  parsed = sanitizeParsedScan(parsed);
  const similarities = new Map(imageHits.filter(hit => Number.isFinite(hit.similarity))
    .map(hit => [hit.cardId, hit.similarity]));
  const familySimilarity = new Map<string, number>();
  for (const row of rows) {
    const similarity = similarities.get(row.id);
    if (similarity !== undefined) familySimilarity.set(scanFamilyKey(row),
      Math.max(similarity, familySimilarity.get(scanFamilyKey(row)) ?? -1));
  }
  const visual: ScoredMatch[] = rows.flatMap(row => {
    const familyKey = scanFamilyKey(row);
    const direct = similarities.get(row.id);
    const similarity = direct ?? familySimilarity.get(familyKey);
    if (similarity === undefined) return [];
    const { score, reasons } = scoreCandidate(row, parsed);
    const conflicts = reasons.filter(reason => reason.includes('conflicts'));
    return [{
      cardId: row.id, name: row.name, cardNumber: row.cardNumber,
      setName: row.setName, subsetName: row.variation || (row.isInsertSubset ? row.setName : null),
      year: row.setYear, imageUrl: row.frontImageUrl,
      // Keep metadata influence bounded so text cannot replace picture retrieval.
      confidence: Math.max(1, similarity * 100 + Math.max(-12, Math.min(6, score / 20))),
      confidenceLevel: similarity >= 0.65 ? 'medium' as const : 'low' as const,
      retrievalSource: direct === undefined ? 'image-family' as const : 'image' as const,
      imageSimilarity: similarity, familyKey, metadataConflicts: conflicts,
      matchReasons: [direct === undefined
        ? 'Checklist-family alternative; artwork alone cannot resolve the variant'
        : 'Retrieved by catalog image similarity', ...reasons],
    }];
  });
  const visualIds = new Set(visual.map(match => match.cardId));
  return [
    ...visual.sort((a, b) => b.confidence - a.confidence || a.cardId - b.cardId),
    ...metadataMatches.filter(match => !visualIds.has(match.cardId)).map(match => ({
      ...match, retrievalSource: 'metadata' as const,
      confidence: Math.min(match.confidence, 44),
      confidenceLevel: 'low' as const,
      matchReasons: [...match.matchReasons, 'Text-only fallback; not retrieved by image similarity'],
    })),
  ];
}

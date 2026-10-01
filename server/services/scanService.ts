import OpenAI from 'openai';
import sharp from 'sharp';
import {
  matchCandidates,
  extractHintsFromText,
  extractKeywords,
  normalizeCardNumber,
  normalizeOcrText,
  normalizeScanField,
  normalizeText,
  retrieveImageCandidateRows,
  rankImageCandidates,
  type ParsedScan,
  type ScoredMatch,
} from './scanMatching';
import type { queryCatalogByImage } from './catalogVisual';

export const FREE_SCAN_LIMIT_PER_MONTH = 25;

// Catalog image retrieval (DINO) stays out of user scans unless explicitly
// enabled. Off = the pre-retrieval flow: OCR -> metadata match -> artwork check.
export const scanVisualRetrievalEnabled = () => process.env.SCAN_VISUAL_RETRIEVAL === 'on';
// GPT artwork verification adds a sequential call (up to 8 s) after OCR; the live
// build never ran it. Off = matcher ranking is returned as-is.
export const scanArtVerificationEnabled = () => process.env.SCAN_ART_VERIFICATION === 'on';

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
  /** Diagnostic only; an unavailable comparison never removes text-only matches.
   * Omitted when SCAN_ART_VERIFICATION is off. */
  visualVerification?: 'verified' | 'uncertain' | 'abstained' | 'unavailable';
  warnings: string[];
  /** Omitted when SCAN_VISUAL_RETRIEVAL is off. */
  imageIndex?: {
    status: 'ready' | 'partial' | 'unavailable';
    indexedCount: number;
    totalEligible: number;
    fallback: 'none' | 'text-only' | 'no-candidates';
  };
  timings: { visualRetrievalMs: number; ocrMs: number; dbMs: number; rerankMs: number; totalMs: number };
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

export async function identifyCardWithVision(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg',
  backImage?: { buffer: Buffer; mimeType: string },
  client: Pick<OpenAI, 'chat'> | null = openai
): Promise<CardVisionResult> {
  if (!client) {
    console.warn('[Scan] OPENAI_API_KEY not set — vision unavailable');
    return EMPTY_VISION;
  }

  const base64 = imageBuffer.toString('base64');

  try {
    const response = await client.chat.completions.create({
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
  "cardNumber": "Checklist card number exactly as printed including any letter prefix (e.g. 85, PP-5, MM23) or null. NEVER use a serial print-run fraction such as 12/100 as cardNumber",
  "year": "4-digit copyright/print year, usually near a small (c) copyright line, or null",
  "brand": "Card manufacturer only (e.g. SkyBox, Upper Deck, Topps, Fleer, Impel, Panini) or null",
  "variant": "Variant/parallel description if different from subsetName (e.g. Refractor, Gold, Silver Signature) or null",
  "copyrightLine": "The small copyright/legal text line if visible, verbatim, or null",
  "serialIndicator": "Serial print-run numbering if visible, e.g. '23/100' or null; this is distinct from the checklist card number"
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
          ...(backImage ? [{
            type: 'text' as const,
            text: 'BACK of the same card. Prioritize clearly printed checklist number, set, year, and explicit parallel/serial markings here. A numbered print run such as 23/100 is a serialIndicator, NOT the checklist cardNumber.',
          }, {
            type: 'image_url' as const,
            image_url: {
              url: `data:${backImage.mimeType};base64,${backImage.buffer.toString('base64')}`,
              detail: 'high' as const,
            },
          }] : []),
        ],
      }],
    }, { timeout: 10000, maxRetries: 0 });

    const text = (response.choices[0]?.message?.content || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const fields = Object.keys(EMPTY_VISION) as (keyof CardVisionResult)[];
      return Object.fromEntries(fields.map(field => [field,
        field === 'ocrText' ? normalizeOcrText(parsed[field]) || null : normalizeScanField(parsed[field]),
      ])) as unknown as CardVisionResult;
    }
  } catch (err) {
    console.error('[Scan] Vision API error:', err);
  }

  return EMPTY_VISION;
}

export function buildParsedScan(vision: CardVisionResult): ParsedScan {
  const rawText = normalizeOcrText(vision.ocrText);
  const hints = extractHintsFromText(rawText);

  // Structured numbers still require a plausible checklist shape. A model
  // joining an artist surname and a nearby year/number is not printed evidence.
  // OCR fallback accepts only explicit #/No. or already-hyphenated identifiers,
  // not loose "NAME 95" pairs. Never elevate serial fractions to checklist IDs.
  const isSerial = (value: string) => /^\s*#?\s*\d{1,5}\s*\/\s*\d{1,6}\s*$/.test(value);
  const proposed = normalizeScanField(vision.cardNumber);
  const normalizedNumber = normalizeCardNumber(proposed);
  const plausibleNumber = /^(?:\d{1,5}|[A-Z]{1,8}-?\d{1,5})$/.test(normalizedNumber);
  const artistSynthesis = !!proposed && /[A-Z]/i.test(proposed)
    && rawText.length > 0
    && !rawText.toUpperCase().includes(normalizedNumber)
    && !new RegExp(`\\b(?:#|NO\\.?\\s*)${normalizedNumber.replace('-', '[- ]?')}\\b`, 'i').test(rawText);
  // A bare number immediately following a printed artist credit is weak
  // evidence, not an exact-number retrieval constraint.
  const creditNumber = !!proposed && /^\d+$/.test(normalizedNumber)
    && new RegExp(`\\b(?:BY|ARTIST|ILLUSTRATED|DAVID)\\s+[A-Z]+\\s*[·,\\-]?\\s*${normalizedNumber}\\b`, 'i').test(rawText)
    && !new RegExp(`(?:#|\\bNO\\.?\\s+)\\s*${normalizedNumber}\\b`, 'i').test(rawText);
  const cardNumber = proposed && plausibleNumber && !isSerial(proposed) && !artistSynthesis && !creditNumber
    ? proposed : hints.cardNumberCandidates.find(value => !isSerial(value)) || null;
  const year = normalizeScanField(vision.year) || hints.yearCandidates[0] || null;
  const setName = normalizeScanField(vision.setName) || hints.setNameCandidates[0] || null;

  const keywordSource = [
    normalizeScanField(vision.characterName),
    setName,
    normalizeScanField(vision.subsetName),
    normalizeScanField(vision.variant),
    rawText,
  ].filter(Boolean).join(' ');

  return {
    characterName: normalizeScanField(vision.characterName),
    setName,
    subsetName: normalizeScanField(vision.subsetName),
    cardNumber,
    year,
    brand: normalizeScanField(vision.brand),
    variant: normalizeScanField(vision.variant),
    copyrightLine: normalizeScanField(vision.copyrightLine),
    serialIndicator: normalizeScanField(vision.serialIndicator),
    keywords: extractKeywords(keywordSource),
  };
}

const MAX_VISUAL_CANDIDATES = 3;
const VISUAL_TIMEOUT_MS = 8000;
type VisualJudgement = 'strong' | 'weak' | 'mismatch' | 'uncertain';

function usableImageUrl(value: string | null): string | null {
  if (!value || /placeholder|fallback|no[-_]?image/i.test(value)) return null;
  try {
    const url = new URL(value);
    // Never send internal or non-public URLs to the model's image fetcher.
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password
      || /^(localhost|.*\.(?:local|internal|localhost))$/i.test(url.hostname)
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
      || url.hostname.includes(':')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Pure reranker: only known, distinct IDs and recognized visual judgments count. */
export function rerankVisualMatches(
  matches: ScanMatch[],
  assessments: { cardId: number; judgement: VisualJudgement }[],
  parsed: ParsedScan
): ScanMatch[] {
  const imageIds = new Set(matches.filter(m => usableImageUrl(m.imageUrl))
    .slice(0, MAX_VISUAL_CANDIDATES).map(m => m.cardId));
  const seen = new Set<number>();
  const valid = new Map<number, VisualJudgement>();
  for (const item of assessments) {
    if (!item || !imageIds.has(item.cardId) || seen.has(item.cardId)) continue;
    if (['strong', 'weak', 'mismatch', 'uncertain'].includes(item.judgement)) {
      seen.add(item.cardId);
      valid.set(item.cardId, item.judgement);
    }
  }
  // A visual "strong" result alone does not prove a parallel. Require an
  // explicit variant/subset cue, not artwork or foil color inference.
  const explicitVariant = normalizeText([parsed.variant, parsed.subsetName].filter(Boolean).join(' '));
  const result = matches.map(match => {
    const judgement = valid.get(match.cardId);
    const adjustment = judgement === 'strong' ? 14 : judgement === 'weak' ? 5
      : judgement === 'mismatch' ? -25 : 0;
    let confidence = Math.max(0, match.confidence + adjustment);
    if (judgement === 'mismatch') confidence = Math.min(confidence, 44);
    const collision = matches.some(other => other.cardId !== match.cardId
      && normalizeCardNumber(other.cardNumber) === normalizeCardNumber(match.cardNumber)
      && normalizeText(other.setName) === normalizeText(match.setName)
      && normalizeText(other.name) === normalizeText(match.name)
      && normalizeText(other.subsetName) !== normalizeText(match.subsetName));
    const variantConfirmed = match.subsetName && explicitVariant.includes(normalizeText(match.subsetName));
    if (collision && !variantConfirmed) confidence = Math.min(confidence, 84);
    // Matcher may have deliberately capped "high" despite a large numeric
    // score (character-only hits, conflicting metadata, near-ties). Artwork
    // can corroborate ordering, but cannot restore eligibility it never had.
    const numericLevel = confidence >= 85 ? 'high' : confidence >= 45 ? 'medium'
      : confidence > 0 ? 'low' : 'none';
    let confidenceLevel: ScanMatch['confidenceLevel'] = numericLevel === 'high' && match.confidenceLevel !== 'high'
      ? 'medium' : numericLevel;
    if (match.retrievalSource) {
      const conflicts = match.metadataConflicts?.length
        || match.matchReasons.some(reason => reason.includes('conflicts'));
      const otherFamilySimilarity = Math.max(-1, ...matches
        .filter(other => other.cardId !== match.cardId && other.familyKey !== match.familyKey)
        .map(other => other.imageSimilarity ?? -1));
      const familyAmbiguous = matches.some(other => other.cardId !== match.cardId
        && other.familyKey === match.familyKey && !variantConfirmed);
      // An exact checklist number is NOT required. Strong picture retrieval,
      // independent artwork verification and separation are required instead.
      const highEligible = match.retrievalSource === 'image'
        && judgement === 'strong' && !conflicts && !familyAmbiguous
        && (match.imageSimilarity ?? 0) >= 0.85
        && (match.imageSimilarity ?? 0) - otherFamilySimilarity >= 0.08;
      confidenceLevel = highEligible ? 'high'
        : confidence >= 45 ? 'medium' : confidence > 0 ? 'low' : 'none';
      if (match.retrievalSource === 'metadata') confidenceLevel = confidence > 0 ? 'low' : 'none';
      if (judgement === 'mismatch') confidenceLevel = confidence > 0 ? 'low' : 'none';
    }
    return {
      ...match, confidence, confidenceLevel,
      matchReasons: judgement && judgement !== 'uncertain'
        ? [...match.matchReasons, judgement === 'mismatch' ? 'Reference artwork differs from scan'
          : judgement === 'strong' ? 'Reference artwork visually corroborates scan'
            : 'Reference artwork partially corroborates scan']
        : match.matchReasons,
    };
  });
  result.sort((a, b) =>
    Number(a.retrievalSource === 'metadata') - Number(b.retrievalSource === 'metadata')
    || b.confidence - a.confidence || a.cardId - b.cardId);
  // Recheck ambiguity after visual score changes as well: a promoted or
  // previously decisive top match can become a near-tie.
  if (result.length > 1 && result[0].confidence - result[1].confidence < 15) {
    for (const item of result) {
      if (result[0].confidence - item.confidence >= 15) break;
      if (item.confidenceLevel === 'high') item.confidenceLevel = 'medium';
    }
  }
  return result;
}

export async function verifyCandidateArt(
  front: Buffer,
  mimeType: string,
  matches: ScanMatch[],
  parsed: ParsedScan,
  client: Pick<OpenAI, 'chat'> | null = openai
): Promise<{ matches: ScanMatch[]; status: NonNullable<ScanResult['visualVerification']> }> {
  const candidates = matches
    .map(m => ({ ...m, reference: usableImageUrl(m.imageUrl) }))
    .filter((m): m is typeof m & { reference: string } => !!m.reference)
    .slice(0, MAX_VISUAL_CANDIDATES);
  if (!client || !candidates.length) return { matches, status: 'unavailable' };
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 240,
      // Only one bounded comparison call over the shortlist, never the catalog.
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Compare the user's FRONT card artwork/composition with the numbered reference images below. Ignore text metadata and generic character likeness: compare actual illustration, crop, pose and background. Foil/color effects cannot establish a specific parallel. Return JSON only: {"assessments":[{"cardId":123,"judgement":"strong|weak|mismatch|uncertain"}],"abstain":false}. Include each presented reference. Use uncertain/abstain if references fail to load, image is unclear, or artwork isn't distinguishable. Do not invent IDs.` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${front.toString('base64')}`, detail: 'high' } },
          ...candidates.flatMap((candidate, index) => [
            { type: 'text' as const, text: `Reference ${index + 1}, cardId ${candidate.cardId}:` },
            { type: 'image_url' as const, image_url: { url: candidate.reference, detail: 'low' as const } },
          ]),
        ],
      }],
    }, { timeout: VISUAL_TIMEOUT_MS, maxRetries: 0 });
    const text = response.choices[0]?.message?.content || '';
    const parsedResponse = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (parsedResponse.abstain === true) return { matches, status: 'abstained' };
    const assessments = Array.isArray(parsedResponse.assessments) ? parsedResponse.assessments : [];
    if (!assessments.length) return { matches, status: 'abstained' };
    const valid = assessments.filter((a: any) => candidates.some(c => c.cardId === a?.cardId)
      && ['strong', 'weak', 'mismatch', 'uncertain'].includes(a.judgement));
    if (!valid.length) return { matches, status: 'abstained' };
    return {
      matches: rerankVisualMatches(matches, valid, parsed),
      status: valid.every((a: any) => a.judgement === 'mismatch') ? 'abstained'
        : valid.some((a: any) => a.judgement === 'strong' || a.judgement === 'weak') ? 'verified' : 'uncertain',
    };
  } catch (err) {
    console.warn('[Scan] Visual comparison unavailable, retaining metadata ranking:', err);
    return { matches, status: 'unavailable' };
  }
}

async function imageWarnings(buffer: Buffer): Promise<string[]> {
  try {
    const meta = await sharp(buffer).metadata();
    const warnings: string[] = [];
    if (Math.min(meta.width || 0, meta.height || 0) < 500) warnings.push('Image is low resolution; small card text may be unreadable.');
    // Small thumbnail histogram: only flag broad bright clipping, not foil highlights.
    const { data, info } = await sharp(buffer).resize(96, 96, { fit: 'fill' })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let clipped = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248) clipped++;
    }
    if (clipped / (info.width * info.height) > 0.3) warnings.push('Possible glare or overexposure; try a photo without reflections.');
    return warnings;
  } catch {
    return [];
  }
}

/**
 * Scan one front image, optionally with a back photo of the SAME card.
 * Route contract: scanCard(front.buffer, front.mimetype,
 *   back ? { buffer: back.buffer, mimeType: back.mimetype } : undefined).
 * Caller must enforce the same MIME/size limits on EACH uploaded image.
 */
export async function scanCard(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg',
  backImage?: { buffer: Buffer; mimeType: string },
  dependencies: {
    queryImage?: typeof queryCatalogByImage;
    identify?: typeof identifyCardWithVision;
    retrieveImageRows?: typeof retrieveImageCandidateRows;
    matchMetadata?: typeof matchCandidates;
    verify?: typeof verifyCandidateArt;
    visualRetrieval?: boolean;
    artVerification?: boolean;
  } = {},
): Promise<ScanResult> {
  const visualRetrieval = dependencies.visualRetrieval ?? scanVisualRetrievalEnabled();
  const artVerification = dependencies.artVerification ?? scanArtVerificationEnabled();
  const started = Date.now();
  const timings = { visualRetrievalMs: 0, ocrMs: 0, dbMs: 0, rerankMs: 0, totalMs: 0 };
  const warnings: string[] = [];
  const { buffer: processedBuffer, preprocessed } = await preprocessImage(imageBuffer);
  const outputMime = preprocessed ? 'image/jpeg' : mimeType;
  const backProcessed = backImage ? await preprocessImage(backImage.buffer) : null;
  const preparedBack = backImage && backProcessed ? {
    buffer: backProcessed.buffer, mimeType: backProcessed.preprocessed ? 'image/jpeg' : backImage.mimeType,
  } : undefined;

  const identify = async () => {
    const start = Date.now();
    try {
      return await (dependencies.identify ?? identifyCardWithVision)(processedBuffer, outputMime, preparedBack);
    } finally { timings.ocrMs = Date.now() - start; }
  };
  // Run independent picture retrieval even when OCR yields no readable text.
  const [vision, imageResult] = await Promise.all([
    identify(),
    visualRetrieval ? (async () => {
      const start = Date.now();
      try {
        return await (dependencies.queryImage ?? (async (buffer: Buffer) =>
          (await import('./catalogVisual')).queryCatalogByImage(buffer)))(processedBuffer);
      } catch (error) {
        console.warn('[Scan] Catalog image retrieval unavailable:', error);
        return { status: 'unavailable' as const, matches: [], indexedCount: 0, totalEligible: 0 };
      } finally { timings.visualRetrievalMs = Date.now() - start; }
    })() : null,
  ]);

  const parsed = buildParsedScan(vision);
  const dbStart = Date.now();
  const [textMatches, imageRows] = await Promise.all([
    (dependencies.matchMetadata ?? matchCandidates)(parsed),
    imageResult ? (dependencies.retrieveImageRows ?? retrieveImageCandidateRows)(imageResult.matches.map(hit => hit.cardId)) : [],
  ]);
  timings.dbMs = Date.now() - dbStart;
  const rerankStart = Date.now();
  // Flag off: metadata matches go to artwork verification unchanged, as before retrieval existed.
  const candidates = imageResult ? rankImageCandidates(imageRows, imageResult.matches, parsed, textMatches) : textMatches;
  const comparison = artVerification
    ? await (dependencies.verify ?? verifyCandidateArt)(processedBuffer, outputMime, candidates, parsed)
    : null;
  timings.rerankMs = Date.now() - rerankStart;
  const matches = comparison?.matches ?? candidates;
  const confidenceLevel = matches.length > 0 ? matches[0].confidenceLevel : 'none';
  const hasImageMatches = candidates.some(match => match.retrievalSource !== 'metadata');
  const fallback = hasImageMatches ? 'none' : matches.length ? 'text-only' : 'no-candidates';
  if (imageResult) {
    if (imageResult.status === 'partial') warnings.push('Catalog image index is incomplete; cards not yet indexed may be missed.');
    if (imageResult.status === 'unavailable') warnings.push('Catalog image search is unavailable. Any suggestions are text-only fallbacks, not picture matches.');
    if (!hasImageMatches && imageResult.status !== 'unavailable') warnings.push('No catalog image candidates were found. Any suggestions below use text only.');
    if (!normalizeOcrText(vision.ocrText) && !parsed.characterName && !parsed.cardNumber && !parsed.setName) {
      warnings.push('No readable identifying text was extracted. Picture candidates can still be reviewed; a back photo may help distinguish variants.');
    }
    if (comparison && comparison.status !== 'verified') warnings.push('Artwork verification was inconclusive or unavailable; review candidate images before confirming.');
    if (matches.some(match => !usableImageUrl(match.imageUrl))) warnings.push('Some candidates have no usable reference image and could not be visually verified.');
  }

  const ocrText = normalizeOcrText(vision.ocrText) || [
    parsed.characterName,
    parsed.setName,
    parsed.year,
    parsed.cardNumber ? `#${parsed.cardNumber}` : null,
    parsed.variant || parsed.subsetName,
  ].filter(Boolean).join(' ');

  warnings.push(...await imageWarnings(imageBuffer));
  timings.totalMs = Date.now() - started;
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
    visualVerification: comparison?.status,
    warnings,
    imageIndex: imageResult ? {
      status: imageResult.status, indexedCount: imageResult.indexedCount,
      totalEligible: imageResult.totalEligible, fallback,
    } : undefined,
    timings,
  };
}

import { XMLParser } from 'fast-xml-parser';
import { db } from '../db';
import { upcomingSetCandidates, setIntelScanLogs, upcomingSets, mainSets, cardSets } from '../../shared/schema';
import { desc, eq, sql, inArray } from 'drizzle-orm';

/**
 * Upcoming Set Intelligence v1 — admin-only detection of upcoming Marvel card
 * releases from multiple sources. Detected items become PENDING candidates
 * for admin review; nothing is ever published to users without approval.
 *
 * Sources (each fails gracefully and independently):
 *  - Topps online shop, Marvel collection (Shopify products.json) — HIGH confidence
 *  - Ripped by Topps blog (Shopify atom feed)                     — MEDIUM/HIGH
 *  - Blowout Buzz / First Buzz RSS                                — MEDIUM (needs review)
 *  - Beckett news RSS                                             — MEDIUM
 *  - Cardboard Connection RSS (the existing upcoming-sets feed)   — MEDIUM
 *
 * Polite scraping: one request per source per scan, 12s timeout, browser-like
 * user agent, no crawling beyond the single listing/feed URL.
 */

const USER_AGENT = 'Mozilla/5.0 (compatible; MarvelCardVault/1.0; +https://marvelcardvault.com)';
const FETCH_TIMEOUT_MS = 12_000;

const MARVEL_TERMS = [
  'marvel', // covers topps marvel, marvel studios, marvel sapphire, marvel comics, etc.
];
const CARD_CONTEXT_TERMS = [
  'card', 'cards', 'chrome', 'sapphire', 'finest', 'mint', 'vault', 'hobby',
  'checklist', 'trading', 'box', 'pack', 'blaster',
];
const EXCLUSION_TERMS = [
  'batman', 'star wars', 'pokemon', 'pokémon', 'baseball', 'football',
  'basketball', 'soccer', 'hockey', 'wwe', 'ufc', 'mls', 'f1', 'nascar',
  'garbage pail', 'digital nft',
];

const DATE_REGEX = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i;
const YEAR_REGEX = /\b(20\d{2})\b/;

// ---------------------------------------------------------------------------
// Setup: tables are created idempotently at startup (db:push is not usable in
// this project, so intelligence tables ship as advisory-locked raw SQL).
// ---------------------------------------------------------------------------

export async function ensureSetIntelTables(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('set-intel-tables'))`);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS upcoming_set_candidates (
        id SERIAL PRIMARY KEY,
        detected_set_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        manufacturer TEXT,
        year INTEGER,
        estimated_release_date TIMESTAMP,
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_type TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        checklist_url TEXT,
        image_url TEXT,
        description TEXT,
        possible_duplicate_of TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_notes TEXT,
        approved_upcoming_set_id INTEGER,
        detected_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS upcoming_set_candidates_normalized_name_idx
      ON upcoming_set_candidates (normalized_name)
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS set_intel_scan_logs (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMP NOT NULL DEFAULT now(),
        finished_at TIMESTAMP,
        trigger TEXT NOT NULL DEFAULT 'manual',
        source_results TEXT,
        candidates_created INTEGER NOT NULL DEFAULT 0,
        source_failures INTEGER NOT NULL DEFAULT 0
      )
    `);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function politeFetch(url: string, accept?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(accept ? { Accept: accept } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSetName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(trading cards?|hobby box|hobby|checklist|preview|revealed|details|breakdown|edition)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMarvelCardRelease(text: string): boolean {
  const lower = text.toLowerCase();
  if (EXCLUSION_TERMS.some(t => lower.includes(t))) return false;
  if (!MARVEL_TERMS.some(t => lower.includes(t))) return false;
  return CARD_CONTEXT_TERMS.some(t => lower.includes(t));
}

function inferManufacturer(title: string): string | null {
  const lower = title.toLowerCase();
  if (lower.includes('topps')) return 'Topps';
  if (lower.includes('panini')) return 'Panini';
  if (lower.includes('upper deck')) return 'Upper Deck';
  if (lower.includes('cardfun') || lower.includes('card fun') || lower.includes('card.fun')) return 'CardFun';
  if (lower.includes('kakawow')) return 'Kakawow';
  if (lower.includes('rittenhouse')) return 'Rittenhouse';
  return null;
}

function extractYear(text: string): number | null {
  const m = text.match(YEAR_REGEX);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const current = new Date().getFullYear();
  return y >= current - 1 && y <= current + 2 ? y : null;
}

function extractDate(text: string): Date | null {
  const m = stripHtml(text).match(DATE_REGEX);
  if (!m) return null;
  const d = new Date(m[0]);
  return isNaN(d.getTime()) ? null : d;
}

export interface DetectedItem {
  detectedSetName: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: string;
  baseConfidence: number;
  imageUrl?: string | null;
  checklistUrl?: string | null;
  description?: string | null;
  estimatedReleaseDate?: Date | null;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  itemsSeen: number;
  marvelMatches: number;
  created: number; // or would-create in dry-run
  skippedDuplicate: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

type SourceFetcher = { name: string; run: () => Promise<{ items: DetectedItem[]; itemsSeen: number }> };

async function fetchRssItems(url: string, sourceName: string, sourceType: string, baseConfidence: number): Promise<{ items: DetectedItem[]; itemsSeen: number }> {
  const res = await politeFetch(url, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);

  // RSS 2.0 or Atom. Bot-protection pages return HTML with a 200 — treat a
  // response with no feed structure as a source failure, not an empty feed.
  if (!parsed?.rss?.channel && !parsed?.feed) {
    throw new Error('Not a valid feed (bot-protected or moved)');
  }
  const rawRss = parsed?.rss?.channel?.item;
  const rawAtom = parsed?.feed?.entry;
  const raw = rawRss ?? rawAtom;
  const entries: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const items: DetectedItem[] = [];
  for (const e of entries) {
    const title = stripHtml(typeof e.title === 'object' ? e.title['#text'] || '' : e.title || '');
    const description = stripHtml(
      typeof e.description === 'string' ? e.description
      : typeof e.summary === 'string' ? e.summary
      : typeof e.content === 'object' ? e.content['#text'] || '' : ''
    ).slice(0, 500);
    let link = '';
    if (typeof e.link === 'string') link = e.link;
    else if (Array.isArray(e.link)) link = e.link.find((l: any) => l['@_rel'] !== 'replies')?.['@_href'] || '';
    else if (e.link?.['@_href']) link = e.link['@_href'];
    if (!title || !link) continue;
    if (!isMarvelCardRelease(`${title} ${description}`)) continue;

    let image: string | null = null;
    const media = e['media:content'];
    if (Array.isArray(media)) image = media[0]?.['@_url'] || null;
    else if (media?.['@_url']) image = media['@_url'];
    if (!image && e.enclosure?.['@_url']) image = e.enclosure['@_url'];

    items.push({
      detectedSetName: title,
      sourceName,
      sourceUrl: link,
      sourceType,
      baseConfidence,
      imageUrl: image,
      description,
      estimatedReleaseDate: extractDate(description),
    });
  }
  return { items, itemsSeen: entries.length };
}

async function fetchToppsShop(): Promise<{ items: DetectedItem[]; itemsSeen: number }> {
  // Topps runs on Shopify — the public products.json listing is a structured,
  // scrape-friendly endpoint (one request; no crawling).
  const res = await politeFetch('https://www.topps.com/collections/marvel/products.json?limit=250', 'application/json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  const products: any[] = Array.isArray(data?.products) ? data.products : [];
  const items: DetectedItem[] = [];
  for (const p of products) {
    const title = (p.title || '').trim();
    const body = stripHtml(p.body_html || '').slice(0, 500);
    if (!title) continue;
    if (!isMarvelCardRelease(`${title} cards ${body}`)) continue; // product pages may omit the word "cards" in title
    items.push({
      detectedSetName: title,
      sourceName: 'Topps Shop (Marvel collection)',
      sourceUrl: `https://www.topps.com/products/${p.handle}`,
      sourceType: 'shop',
      baseConfidence: 85, // official Topps product page naming a Marvel card product
      imageUrl: p.images?.[0]?.src || null,
      description: body || null,
      estimatedReleaseDate: p.published_at ? new Date(p.published_at) : null,
    });
  }
  return { items, itemsSeen: products.length };
}

function buildSources(): SourceFetcher[] {
  return [
    // NOTE: topps.com sits behind bot protection (Incapsula) and often returns
    // 403 to datacenter IPs. The sources stay registered — failures surface in
    // the scan report — and Topps releases are still caught indirectly via the
    // hobby-news feeds below, which cover Topps announcements within hours.
    { name: 'Topps Shop (Marvel collection)', run: fetchToppsShop },
    { name: 'Ripped by Topps', run: () => fetchRssItems('https://www.topps.com/blogs/ripped.atom', 'Ripped by Topps', 'blog', 70) },
    { name: 'Blowout Buzz', run: () => fetchRssItems('https://blowoutcards.com/buzz/feed/', 'Blowout Buzz', 'blog', 55) },
    { name: 'Cardlines', run: () => fetchRssItems('https://www.cardlines.com/feed/', 'Cardlines', 'checklist', 50) },
    { name: 'Cardboard Connection RSS', run: () => fetchRssItems('https://www.cardboardconnection.com/feed', 'Cardboard Connection', 'rss', 60) },
  ];
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

async function loadKnownNames(): Promise<{ upcoming: Map<string, string>; existing: Map<string, string> }> {
  const upcoming = new Map<string, string>();
  const existing = new Map<string, string>();
  const up = await db.select({ name: upcomingSets.setName }).from(upcomingSets);
  for (const u of up) upcoming.set(normalizeSetName(u.name), u.name);
  const mains = await db.select({ name: mainSets.name }).from(mainSets);
  for (const m of mains) existing.set(normalizeSetName(m.name), m.name);
  return { upcoming, existing };
}

/** Loose match: exact normalized equality, or one contains the other (min length 12 to avoid junk matches). */
function findLooseMatch(normalized: string, known: Map<string, string>): string | null {
  if (known.has(normalized)) return known.get(normalized)!;
  for (const [k, original] of known) {
    if (k.length >= 12 && normalized.length >= 12 && (k.includes(normalized) || normalized.includes(k))) return original;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface ScanReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  sources: SourceResult[];
  candidatesCreated: number;
  wouldCreate: Array<{ name: string; source: string; confidence: number; status: string; possibleDuplicateOf?: string | null }>;
}

let scanInProgress = false;

export async function runSetIntelScan(opts: { dryRun: boolean; trigger?: string }): Promise<ScanReport> {
  if (scanInProgress) throw new Error('A scan is already in progress');
  scanInProgress = true;
  const startedAt = new Date();
  const sources: SourceResult[] = [];
  const wouldCreate: ScanReport['wouldCreate'] = [];
  let candidatesCreated = 0;

  try {
    const { upcoming, existing } = await loadKnownNames();
    const existingCandidates = await db.select({ normalizedName: upcomingSetCandidates.normalizedName, sourceUrl: upcomingSetCandidates.sourceUrl }).from(upcomingSetCandidates);
    const knownCandidateNames = new Set(existingCandidates.map(c => c.normalizedName));
    const knownCandidateUrls = new Set(existingCandidates.map(c => c.sourceUrl));
    const seenThisScan = new Set<string>();

    for (const source of buildSources()) {
      const result: SourceResult = { source: source.name, ok: true, itemsSeen: 0, marvelMatches: 0, created: 0, skippedDuplicate: 0 };
      try {
        const { items, itemsSeen } = await source.run();
        result.itemsSeen = itemsSeen;
        result.marvelMatches = items.length;

        for (const item of items) {
          const normalized = normalizeSetName(item.detectedSetName);
          if (!normalized || normalized.length < 8) continue;

          // Never re-suggest something already suggested (any status) or seen this scan
          if (knownCandidateNames.has(normalized) || knownCandidateUrls.has(item.sourceUrl) || seenThisScan.has(normalized)) {
            result.skippedDuplicate++;
            continue;
          }
          seenThisScan.add(normalized);

          const matchUpcoming = findLooseMatch(normalized, upcoming);
          const matchExisting = matchUpcoming ? null : findLooseMatch(normalized, existing);
          const possibleDuplicateOf = matchUpcoming ? `Upcoming Set: ${matchUpcoming}` : matchExisting ? `Existing Set: ${matchExisting}` : null;

          let confidence = item.baseConfidence;
          if (item.estimatedReleaseDate) confidence = Math.min(95, confidence + 10);
          const status = possibleDuplicateOf ? 'needs_review' : confidence < 65 ? 'needs_review' : 'pending';

          if (opts.dryRun) {
            wouldCreate.push({ name: item.detectedSetName, source: item.sourceName, confidence, status, possibleDuplicateOf });
            result.created++;
            continue;
          }

          await db.insert(upcomingSetCandidates).values({
            detectedSetName: item.detectedSetName,
            normalizedName: normalized,
            manufacturer: inferManufacturer(item.detectedSetName),
            year: extractYear(item.detectedSetName) ?? extractYear(item.description || ''),
            estimatedReleaseDate: item.estimatedReleaseDate ?? null,
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
            sourceType: item.sourceType,
            confidence,
            imageUrl: item.imageUrl ?? null,
            checklistUrl: item.checklistUrl ?? null,
            description: item.description ?? null,
            possibleDuplicateOf,
            status,
          }).onConflictDoNothing({ target: upcomingSetCandidates.normalizedName });
          knownCandidateNames.add(normalized);
          knownCandidateUrls.add(item.sourceUrl);
          result.created++;
          candidatesCreated++;
          wouldCreate.push({ name: item.detectedSetName, source: item.sourceName, confidence, status, possibleDuplicateOf });
        }
      } catch (err: any) {
        result.ok = false;
        result.error = err?.message || String(err);
        console.error(`[Set Intel] Source "${source.name}" failed:`, result.error);
      }
      console.log(`[Set Intel] ${source.name}: ok=${result.ok} seen=${result.itemsSeen} marvel=${result.marvelMatches} ${opts.dryRun ? 'wouldCreate' : 'created'}=${result.created} dup=${result.skippedDuplicate}${result.error ? ` error=${result.error}` : ''}`);
      sources.push(result);
    }

    const finishedAt = new Date();
    // Dry-run writes NOTHING — not even a scan log row.
    if (!opts.dryRun) {
      await db.insert(setIntelScanLogs).values({
        startedAt,
        finishedAt,
        trigger: opts.trigger || 'manual',
        sourceResults: JSON.stringify(sources),
        candidatesCreated,
        sourceFailures: sources.filter(s => !s.ok).length,
      });
    }

    return {
      dryRun: opts.dryRun,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      sources,
      candidatesCreated: opts.dryRun ? 0 : candidatesCreated,
      wouldCreate,
    };
  } finally {
    scanInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Stats for the admin dashboard section
// ---------------------------------------------------------------------------

export async function getSetIntelStats() {
  const [counts]: any = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE detected_at::date = CURRENT_DATE)::int AS found_today,
      count(*) FILTER (WHERE status IN ('pending','needs_review'))::int AS pending_review,
      count(*) FILTER (WHERE status = 'approved' AND updated_at > date_trunc('month', now()))::int AS approved_this_month,
      count(*) FILTER (WHERE status IN ('ignored','duplicate'))::int AS ignored_or_duplicate
    FROM upcoming_set_candidates
  `)).rows;
  const [lastScan] = await db.select().from(setIntelScanLogs).orderBy(desc(setIntelScanLogs.id)).limit(1);
  return {
    foundToday: counts?.found_today ?? 0,
    pendingReview: counts?.pending_review ?? 0,
    approvedThisMonth: counts?.approved_this_month ?? 0,
    ignoredOrDuplicates: counts?.ignored_or_duplicate ?? 0,
    lastScanAt: lastScan?.finishedAt ?? lastScan?.startedAt ?? null,
    lastScanSourceFailures: lastScan?.sourceFailures ?? 0,
    lastScanSources: lastScan?.sourceResults ? JSON.parse(lastScan.sourceResults) : null,
  };
}

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
// Manual quick-add (admin fallback for bot-protected sources)
// ---------------------------------------------------------------------------

/**
 * SSRF guard: only allow fetches to public internet hosts. Blocks loopback,
 * RFC1918/link-local/CGNAT ranges, cloud metadata endpoints, and non-http(s)
 * schemes. Resolves DNS so hostnames pointing at internal IPs are also blocked.
 */
async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http/https URLs are allowed');
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('URL host is not allowed');
  }
  const dns = await import('node:dns/promises');
  const net = await import('node:net');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  const isPrivate = (ip: string): boolean => {
    if (ip.includes(':')) {
      const v6 = ip.toLowerCase();
      if (v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd') || v6 === '::') return true;
      if (v6.startsWith('::ffff:')) return isPrivate(v6.slice(7));
      return false;
    }
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(isNaN)) return true;
    return p[0] === 0 || p[0] === 127 || p[0] === 10
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || (p[0] === 169 && p[1] === 254) // link-local incl. 169.254.169.254 metadata
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); // CGNAT
  };
  if (addrs.length === 0 || addrs.some(a => isPrivate(a.address))) throw new Error('URL host is not allowed');
  return parsed;
}

/**
 * Best-effort metadata fetch for a pasted URL. Bot protection or any failure
 * returns { ok: false } — it must NEVER block manual entry. Single polite
 * request per hop, max 3 redirects, every hop re-validated against the SSRF
 * guard (no unvalidated redirect following).
 */
export async function fetchUrlMetadata(url: string): Promise<{ ok: boolean; title?: string; description?: string; imageUrl?: string; error?: string }> {
  try {
    let current = (await assertPublicHttpUrl(url)).toString();
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = (await assertPublicHttpUrl(new URL(loc, current).toString())).toString();
        continue;
      }
      break;
    }
    if (!res || !res.ok) return { ok: false, error: `HTTP ${res?.status ?? 'error'} (page may be bot-protected)` };
    const html = (await res.text()).slice(0, 500_000);
    const og = (prop: string): string | undefined => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
      return m?.[1];
    };
    const title = og('og:title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const description = og('og:description') || og('description');
    const imageUrl = og('og:image');
    if (!title && !description && !imageUrl) return { ok: false, error: 'No metadata found (page may be bot-protected)' };
    return { ok: true, title: title ? stripHtml(title).slice(0, 300) : undefined, description: description ? stripHtml(description).slice(0, 500) : undefined, imageUrl };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Fetch failed' };
  }
}

export interface ManualCandidateInput {
  detectedSetName: string;
  sourceUrl: string;
  sourceName?: string;
  manufacturer?: string | null;
  year?: number | null;
  estimatedReleaseDate?: string | null;
  checklistUrl?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  adminNotes?: string | null;
  usedUrlMetadata?: boolean;
}

/**
 * Save a manually entered candidate. Runs the SAME duplicate detection as the
 * scanner (existing candidates via unique normalized_name, plus loose matching
 * against upcoming sets, main sets, and card sets). Always saved as a pending/
 * needs_review candidate — never published directly.
 */
export async function createManualCandidate(input: ManualCandidateInput) {
  const name = String(input.detectedSetName || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();
  if (!name) throw new Error('Set name is required');
  if (!/^https?:\/\//i.test(sourceUrl)) throw new Error('A valid source URL (http/https) is required');

  const normalizedName = normalizeSetName(name);
  if (!normalizedName) throw new Error('Set name is required');

  // Duplicate detection — candidates (any status)
  const [existingCandidate] = await db.select({ id: upcomingSetCandidates.id, name: upcomingSetCandidates.detectedSetName, status: upcomingSetCandidates.status })
    .from(upcomingSetCandidates).where(eq(upcomingSetCandidates.normalizedName, normalizedName));
  if (existingCandidate) {
    throw new Error(`A candidate with this name already exists (“${existingCandidate.name}”, status: ${existingCandidate.status})`);
  }

  // Loose matching vs upcoming sets, main sets, and card sets
  const { upcoming, existing } = await loadKnownNames();
  const subsetRows = await db.select({ name: cardSets.name }).from(cardSets);
  const subsets = new Map<string, string>();
  for (const s of subsetRows) subsets.set(normalizeSetName(s.name), s.name);

  const matchUpcoming = findLooseMatch(normalizedName, upcoming);
  const matchExisting = findLooseMatch(normalizedName, existing);
  const matchSubset = matchUpcoming || matchExisting ? null : findLooseMatch(normalizedName, subsets);
  const possibleDuplicateOf = matchUpcoming ? `Upcoming Set: ${matchUpcoming}`
    : matchExisting ? `Existing Set: ${matchExisting}`
    : matchSubset ? `Existing Card Set: ${matchSubset}` : null;

  const [created] = await db.insert(upcomingSetCandidates).values({
    detectedSetName: name,
    normalizedName,
    manufacturer: input.manufacturer?.trim() || inferManufacturer(name),
    year: input.year ?? extractYear(name),
    estimatedReleaseDate: input.estimatedReleaseDate ? new Date(input.estimatedReleaseDate) : null,
    sourceName: input.sourceName?.trim() || 'Manual entry',
    sourceUrl,
    sourceType: input.usedUrlMetadata ? 'manual_url' : 'manual_entry',
    confidence: 90, // admin-entered — high confidence
    checklistUrl: input.checklistUrl?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
    description: input.description?.trim().slice(0, 1000) || null,
    possibleDuplicateOf,
    status: possibleDuplicateOf ? 'needs_review' : 'pending',
    adminNotes: input.adminNotes?.trim() || null,
  }).returning();
  return created;
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

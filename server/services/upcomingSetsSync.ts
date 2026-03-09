import { CronJob } from 'cron';
import { XMLParser } from 'fast-xml-parser';
import { storage } from '../storage';
import type { InsertUpcomingSet } from '../../shared/schema';

const FEED_URL = 'https://www.cardboardconnection.com/feed';

const INCLUSION_KEYWORDS = [
  'marvel',
  'captain america cards',
  'avengers cards',
  'x-men cards',
  'spider-man cards',
  'topps marvel',
  'panini marvel',
  'upper deck marvel',
];

const EXCLUSION_KEYWORDS = [
  'batman',
  'star wars',
  'pokemon',
  'baseball',
  'football',
  'basketball',
  'soccer',
  'hockey',
];

const DATE_REGEX = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i;

interface SyncResult {
  added: number;
  skippedDuplicate: number;
  skippedNotMarvel: number;
  errors: number;
}

interface RSSItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  'media:content'?: { '@_url'?: string } | Array<{ '@_url'?: string }>;
  enclosure?: { '@_url'?: string };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function inferManufacturer(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('topps')) return 'Topps';
  if (lower.includes('panini')) return 'Panini';
  if (lower.includes('upper deck')) return 'Upper Deck';
  if (lower.includes('card fun')) return 'Card Fun';
  if (lower.includes('wizards of the coast') || lower.includes('magic:') || lower.includes('mtg')) return 'Wizards of the Coast';
  return 'Unknown';
}

function extractThumbnailUrl(item: RSSItem): string | null {
  if (item['media:content']) {
    const media = item['media:content'];
    if (Array.isArray(media)) {
      const first = media[0];
      if (first?.['@_url']) return first['@_url'];
    } else if (media?.['@_url']) {
      return media['@_url'];
    }
  }
  if (item.enclosure?.['@_url']) {
    return item.enclosure['@_url'];
  }
  return null;
}

function parseReleaseDate(description: string, pubDate?: string): { date: Date; confidence: 'confirmed' | 'estimated' } {
  const stripped = stripHtml(description || '');
  const match = stripped.match(DATE_REGEX);

  if (match) {
    const parsed = new Date(match[0]);
    if (!isNaN(parsed.getTime())) {
      return { date: parsed, confidence: 'confirmed' };
    }
  }

  const fallback = pubDate ? new Date(pubDate) : new Date();
  fallback.setDate(fallback.getDate() + 60);
  return { date: fallback, confidence: 'estimated' };
}

export async function syncRSSFeed(): Promise<SyncResult> {
  const result: SyncResult = { added: 0, skippedDuplicate: 0, skippedNotMarvel: 0, errors: 0 };

  try {
    const response = await fetch(FEED_URL);
    if (!response.ok) {
      console.error(`[RSS Sync] Failed to fetch feed: ${response.status}`);
      result.errors++;
      return result;
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const parsed = parser.parse(xml);

    const rawItems = parsed?.rss?.channel?.item;
    const items: RSSItem[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    for (const item of items) {
      try {
        const title = item.title || '';
        const description = item.description || '';
        const combined = `${title} ${description}`;

        if (matchesKeywords(combined, EXCLUSION_KEYWORDS)) {
          result.skippedNotMarvel++;
          continue;
        }

        if (!matchesKeywords(combined, INCLUSION_KEYWORDS)) {
          result.skippedNotMarvel++;
          continue;
        }

        const sourceUrl = item.link || '';
        if (!sourceUrl) {
          result.errors++;
          continue;
        }

        const existing = await storage.getUpcomingSetBySourceUrl(sourceUrl);
        if (existing) {
          result.skippedDuplicate++;
          continue;
        }

        const { date, confidence } = parseReleaseDate(description, item.pubDate);
        const highlights = stripHtml(description).slice(0, 500);

        const setData: InsertUpcomingSet = {
          setName: title,
          manufacturer: inferManufacturer(title),
          releaseDateEstimated: date,
          dateConfidence: confidence,
          keyHighlights: highlights,
          sourceUrl: sourceUrl,
          thumbnailUrl: extractThumbnailUrl(item),
          status: 'upcoming',
          isActive: true,
        };

        await storage.createUpcomingSet(setData);
        result.added++;
      } catch (itemError) {
        console.error(`[RSS Sync] Error processing item:`, itemError);
        result.errors++;
      }
    }
  } catch (error) {
    console.error(`[RSS Sync] Feed fetch/parse error:`, error);
    result.errors++;
  }

  console.log(`[RSS Sync] Added: ${result.added} | Skipped (duplicate): ${result.skippedDuplicate} | Skipped (not Marvel): ${result.skippedNotMarvel} | Errors: ${result.errors}`);
  return result;
}

export async function expireReleasedSets(): Promise<number> {
  const allSets = await storage.getAllUpcomingSets();
  const now = new Date();
  let expiredCount = 0;

  for (const set of allSets) {
    if (set.status === 'released') continue;
    if (!set.releaseDateEstimated) continue;
    if (new Date(set.releaseDateEstimated) > now) continue;

    await storage.updateUpcomingSet(set.id, { status: 'released', isActive: false });
    expiredCount++;

    try {
      const interestedUserIds = await storage.getInterestedUserIds(set.id);
      if (interestedUserIds.length > 0) {
        const systemUser = await storage.getOrCreateSystemUser();
        const setName = set.setName;
        const message = `Today is the launch of "${setName}"! Head to your favorite retailer to grab your packs. Happy collecting!`;

        for (const userId of interestedUserIds) {
          if (userId === systemUser.id) continue;
          try {
            await storage.sendMessage(systemUser.id, userId, message);
          } catch (msgError) {
            console.error(`[Auto-Expire] Failed to message user ${userId}:`, msgError);
          }
        }
        console.log(`[Auto-Expire] Sent launch alerts to ${interestedUserIds.length} users for "${setName}"`);
      }
    } catch (notifyError) {
      console.error(`[Auto-Expire] Error sending notifications for set ${set.id}:`, notifyError);
    }
  }

  console.log(`[Auto-Expire] Marked ${expiredCount} sets as released`);
  return expiredCount;
}

const SEED_SETS: Array<InsertUpcomingSet> = [
  {
    setName: '2026 Topps Finest Fantastic Four 65th Anniversary',
    manufacturer: 'Topps',
    releaseDateEstimated: new Date('2026-04-15'),
    dateConfidence: 'confirmed',
    keyHighlights: 'Premium chromium product celebrating the Fantastic Four\'s 65th anniversary. Features chrome card technology, autographs, and refractors.',
    sourceUrl: 'internal://seed-ff',
    status: 'upcoming',
    isActive: true,
  },
  {
    setName: 'Magic: The Gathering Marvel Super Heroes',
    manufacturer: 'Wizards of the Coast',
    releaseDateEstimated: new Date('2026-06-26'),
    dateConfidence: 'confirmed',
    keyHighlights: 'Historic crossover bringing Marvel characters into the MTG universe. Full card game mechanics with Marvel character abilities and artwork.',
    sourceUrl: 'internal://seed-mtg',
    status: 'upcoming',
    isActive: true,
  },
  {
    setName: '2026 Topps Chrome Marvel Studios',
    manufacturer: 'Topps',
    releaseDateEstimated: new Date('2026-12-01'),
    dateConfidence: 'estimated',
    keyHighlights: 'Chrome technology meets the MCU. Features current and upcoming Marvel Studios releases with on-card autographs and refractor parallels.',
    sourceUrl: 'internal://seed-chrome',
    status: 'upcoming',
    isActive: true,
  },
];

export async function seedUpcomingSets(): Promise<void> {
  for (const seedSet of SEED_SETS) {
    const existing = await storage.getUpcomingSetByName(seedSet.setName);
    if (!existing) {
      await storage.createUpcomingSet(seedSet);
      console.log(`[Seed] Created upcoming set: ${seedSet.setName}`);
    }
  }
}

let cronJobsStarted = false;

export function startUpcomingSetsCronJobs(): void {
  if (cronJobsStarted) return;
  cronJobsStarted = true;

  const rssSyncJob = new CronJob(
    '0 */6 * * *',
    async () => {
      try {
        await syncRSSFeed();
      } catch (error) {
        console.error('[RSS Sync] Cron job error:', error);
      }
    },
    null,
    false,
    'America/Chicago'
  );
  rssSyncJob.start();

  const expireJob = new CronJob(
    '0 6 * * *',
    async () => {
      try {
        await expireReleasedSets();
      } catch (error) {
        console.error('[Auto-Expire] Cron job error:', error);
      }
    },
    null,
    false,
    'America/Chicago'
  );
  expireJob.start();

  console.log('[Upcoming Sets] Cron jobs started: RSS sync (every 6h), Auto-expire (daily 6 AM CT)');
}

export async function initializeUpcomingSets(): Promise<void> {
  await seedUpcomingSets();
  startUpcomingSetsCronJobs();
}

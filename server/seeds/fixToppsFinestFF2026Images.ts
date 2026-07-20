import { db } from '../db';
import { cardSets, cards } from '../../shared/schema';
import { eq, and, isNull, or, inArray, sql } from 'drizzle-orm';
import imageData from './data/toppsFinestFF2026Images.json';

/**
 * One-time data fix: copy 100 card images (added in the dev workspace) for
 * 2026 Topps Finest Fantastic Four: 65th Anniversary into production.
 *
 * Idempotent + advisory-locked: only fills images where front_image_url is
 * still empty — never overwrites an image that already exists (so any images
 * added directly in prod are preserved). Safe to remove this block after it
 * has run once in production (log line: "[Topps Finest FF Images] ...").
 */

type ImageRow = { subsetSlug: string; cardNumber: string; frontImageUrl: string; backImageUrl: string | null };
const IMAGES = imageData as ImageRow[];

export async function fixToppsFinestFF2026Images(): Promise<void> {
  const slugs = Array.from(new Set(IMAGES.map(i => i.subsetSlug)));

  // Cheap pre-check: skip entirely if no target card is still missing an image
  const bySlug = new Map<string, ImageRow[]>();
  for (const row of IMAGES) {
    if (!bySlug.has(row.subsetSlug)) bySlug.set(row.subsetSlug, []);
    bySlug.get(row.subsetSlug)!.push(row);
  }

  const subsets = await db.select({ id: cardSets.id, slug: cardSets.slug })
    .from(cardSets).where(inArray(cardSets.slug, slugs));
  if (subsets.length === 0) return; // set not seeded yet (shouldn't happen — runs after seed)

  let candidates = 0;
  for (const subset of subsets) {
    const rows = bySlug.get(subset.slug)!;
    const [c] = await db.select({ n: sql<number>`count(*)::int` })
      .from(cards)
      .where(and(
        eq(cards.setId, subset.id),
        inArray(cards.cardNumber, rows.map(r => r.cardNumber)),
        or(isNull(cards.frontImageUrl), eq(cards.frontImageUrl, '')),
      ));
    candidates += c?.n ?? 0;
  }
  if (candidates === 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-topps-finest-ff-2026-images'))`);

    let updated = 0;
    for (const subset of subsets) {
      for (const row of bySlug.get(subset.slug)!) {
        const result = await tx.update(cards)
          .set({ frontImageUrl: row.frontImageUrl, ...(row.backImageUrl ? { backImageUrl: row.backImageUrl } : {}) })
          .where(and(
            eq(cards.setId, subset.id),
            eq(cards.cardNumber, row.cardNumber),
            or(isNull(cards.frontImageUrl), eq(cards.frontImageUrl, '')),
          ))
          .returning({ id: cards.id });
        updated += result.length;
      }
    }
    console.log(`[Topps Finest FF Images] ✅ Applied ${updated} of ${IMAGES.length} card images (empty-only, no overwrites)`);
  });
}

import { db } from '../db';
import { cardSets, cards } from '../../shared/schema';
import { eq, and, sql, isNull, like, inArray } from 'drizzle-orm';
import checklistData from './data/tcms2025Base.json';

/**
 * One-time idempotent fix: 2025 Topps Chrome Marvel Studios checklist.
 *
 * Problems fixed (safe to run on every startup, dev and prod — matches by slug):
 *  1. The base set only had 62 of the real 200 cards (#1–200 per the official
 *     checklist), and ~45 of those were actually parallels with the color baked
 *     into the name, e.g. "Falcon [Gold]". Strays are moved into their proper
 *     parallel set (or archived if the slot is taken / unmappable), with any
 *     collection/wishlist entries repointed first.
 *  2. The Snap Variations set had duplicate rows like "Iron Man #S-1" next to
 *     clean "Iron Man" rows. Suffixed rows are deduped/renamed.
 *  3. Every base parallel set (plus the Snap parallels) is completed to the
 *     full 200-card checklist. Three parallel sets from the official sheet
 *     that were missing entirely (Red Wave, Red Geometric, SuperFractor) are
 *     created.
 *
 * Checklist source: server/seeds/data/tcms2025Base.json (200 entries, from the
 * published checklist; `movie` becomes the card description).
 */

type Entry = { n: number; name: string; movie: string; debut?: boolean };
const CHECKLIST = checklistData as Entry[];

const SLUG_PREFIX = '2025-2025-topps-chrome-marvel-studios-';
const NAME_PREFIX = '2025 Topps Chrome Marvel Studios - ';

// Sets that carry the full 200-card base checklist. suffix = slug suffix.
const FULL_CHECKLIST_SETS: Array<{ suffix: string; name: string; createIfMissing?: boolean }> = [
  { suffix: 'base', name: '2025 Topps Chrome Marvel Studios' },
  { suffix: 'agatha-lava-refractor', name: 'Agatha Lava Refractor' },
  { suffix: 'black-geometric-refractor', name: 'Black Geometric Refractor' },
  { suffix: 'black-refractor', name: 'Black Refractor' },
  { suffix: 'black-wave-refractor', name: 'Black Wave Refractor' },
  { suffix: 'captain-america-refractor', name: 'Captain America Refractor' },
  { suffix: 'gold-refractor', name: 'Gold Refractor' },
  { suffix: 'gold-wave-refractor', name: 'Gold Wave Refractor' },
  { suffix: 'green-refractor', name: 'Green Refractor' },
  { suffix: 'loki-refractor', name: 'Loki Refractor' },
  { suffix: 'marvel-red-black-lava-refractor', name: 'Marvel Red & Black Lava Refractor' },
  { suffix: 'ms-marvel-speckle-refractor', name: 'Ms. Marvel Speckle Refractor' },
  { suffix: 'orange-geometric-refractor', name: 'Orange Geometric Refractor' },
  { suffix: 'orange-refractor', name: 'Orange Refractor' },
  { suffix: 'orange-wave-refractor', name: 'Orange Wave Refractor' },
  { suffix: 'printing-plates-black', name: 'Printing Plates Black' },
  { suffix: 'printing-plates-cyan', name: 'Printing Plates Cyan' },
  { suffix: 'printing-plates-magenta', name: 'Printing Plates Magenta' },
  { suffix: 'printing-plates-yellow', name: 'Printing Plates Yellow' },
  { suffix: 'prism-refractor', name: 'Prism Refractor' },
  { suffix: 'rainbow-refractor', name: 'Rainbow Refractor' },
  { suffix: 'red-refractor', name: 'Red Refractor' },
  { suffix: 'shimmer-refractor', name: 'Shimmer Refractor' },
  { suffix: 'sky-blue-raywave-refractor', name: 'Sky Blue RayWave Refractor' },
  { suffix: 'thor-refractor', name: 'Thor Refractor' },
  // Present on the official parallel sheet but missing from our DB entirely:
  { suffix: 'red-wave-refractor', name: 'Red Wave Refractor', createIfMissing: true },
  { suffix: 'red-geometric-refractor', name: 'Red Geometric Refractor', createIfMissing: true },
  { suffix: 'superfractor', name: 'SuperFractor', createIfMissing: true },
  // The Snap Variations (full base checklist /99) + its refractor parallels
  { suffix: 'the-snap-variations', name: 'The Snap Variations' },
  { suffix: 'the-snap-variations-black-refractor', name: 'The Snap Variations Black Refractor' },
  { suffix: 'the-snap-variations-gold-refractor', name: 'The Snap Variations Gold Refractor' },
  { suffix: 'the-snap-variations-orange-refractor', name: 'The Snap Variations Orange Refractor' },
  { suffix: 'the-snap-variations-red-refractor', name: 'The Snap Variations Red Refractor' },
  { suffix: 'the-snap-variations-superfractor', name: 'The Snap Variations Superfractor' },
];

// "[Bracket]" in a base-set card name -> slug suffix of the parallel set it
// belongs to. "Printing Plate" is ambiguous (4 plate colors) -> archive.
const BRACKET_TO_SUFFIX: Record<string, string | null> = {
  'Captain America': 'captain-america-refractor',
  'Orange': 'orange-refractor',
  'Green': 'green-refractor',
  'Gold': 'gold-refractor',
  'Black': 'black-refractor',
  'Agatha Lava': 'agatha-lava-refractor',
  'Gold Wave': 'gold-wave-refractor',
  "Thor's Lightning": 'thor-refractor',
  'Red Wave': 'red-wave-refractor',
  'Sky Blue RayWave': 'sky-blue-raywave-refractor',
  'Shimmer': 'shimmer-refractor',
  'Loki': 'loki-refractor',
  'Red Geometric': 'red-geometric-refractor',
  'Marvel Red Black Lava': 'marvel-red-black-lava-refractor',
  'Ms Marvel Speckle': 'ms-marvel-speckle-refractor',
  'Prism': 'prism-refractor',
  'Black Wave': 'black-wave-refractor',
  'Orange Geometric': 'orange-geometric-refractor',
  'Red': 'red-refractor',
  'Printing Plate': null,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function repointAndArchive(tx: Tx, fromCardId: number, toCardId: number, reason: string): Promise<void> {
  if (toCardId !== fromCardId) {
    // Conflict-aware: user_collections/user_wishlists have unique
    // (user_id, card_id) indexes. If the user already holds the target card,
    // merge quantities into the survivor, then drop the duplicate row.
    await tx.execute(sql`
      UPDATE user_collections t SET quantity = t.quantity + d.quantity
      FROM user_collections d
      WHERE t.user_id = d.user_id AND t.card_id = ${toCardId} AND d.card_id = ${fromCardId}`);
    await tx.execute(sql`
      UPDATE user_collections uc SET card_id = ${toCardId}
      WHERE uc.card_id = ${fromCardId}
        AND NOT EXISTS (SELECT 1 FROM user_collections t WHERE t.user_id = uc.user_id AND t.card_id = ${toCardId})`);
    await tx.execute(sql`DELETE FROM user_collections WHERE card_id = ${fromCardId}`);
    await tx.execute(sql`
      UPDATE user_wishlists uw SET card_id = ${toCardId}
      WHERE uw.card_id = ${fromCardId}
        AND NOT EXISTS (SELECT 1 FROM user_wishlists t WHERE t.user_id = uw.user_id AND t.card_id = ${toCardId})`);
    await tx.execute(sql`DELETE FROM user_wishlists WHERE card_id = ${fromCardId}`);
  }
  await tx.update(cards)
    .set({ archivedAt: sql`now()`, archiveReason: reason })
    .where(eq(cards.id, fromCardId));
}

const MARKER = 'tcms_2025_checklist_fix_v4';

export async function fixTcms2025Checklist(): Promise<void> {
  // Marker-gated: skip once a full pass has completed successfully. The
  // marker is written inside the same transaction as the fix, so a failed
  // run retries on the next startup.
  const done = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
  if (((done as any).rows ?? []).length > 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-tcms-2025-checklist'))`);
    // Re-check under the lock (another instance may have just finished)
    const again = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
    if (((again as any).rows ?? []).length > 0) return;

    // Resolve all target sets by slug (create the three known-missing ones)
    const slugs = FULL_CHECKLIST_SETS.map(s => `${SLUG_PREFIX}${s.suffix}`);
    const found = await tx.select({ id: cardSets.id, slug: cardSets.slug })
      .from(cardSets).where(inArray(cardSets.slug, slugs));
    const bySuffix = new Map<string, number>();
    for (const row of found) bySuffix.set(row.slug.slice(SLUG_PREFIX.length), row.id);

    const [mainSet] = await tx.execute(sql`SELECT id FROM main_sets WHERE slug = '2025-topps-chrome-marvel-studios'`)
      .then((r: any) => r.rows as Array<{ id: number }>);
    for (const def of FULL_CHECKLIST_SETS) {
      if (bySuffix.has(def.suffix)) continue;
      if (!def.createIfMissing) {
        console.warn(`[TCMS 2025 Fix] Set not found, skipping: ${def.suffix}`);
        continue;
      }
      const [created] = await tx.insert(cardSets).values({
        name: `${NAME_PREFIX}${def.name}`,
        slug: `${SLUG_PREFIX}${def.suffix}`,
        year: 2025,
        mainSetId: mainSet?.id ?? null,
        isActive: true,
        isCanonical: true,
        totalCards: 0,
      }).onConflictDoNothing({ target: cardSets.slug }).returning({ id: cardSets.id });
      if (created) bySuffix.set(def.suffix, created.id);
    }

    const baseSetId = bySuffix.get('base');
    if (!baseSetId) throw new Error('TCMS 2025 base set not found by slug');

    // ── 1. Relocate bracketed parallel strays out of the base set ──────────
    const strays = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
      .from(cards)
      .where(and(eq(cards.setId, baseSetId), isNull(cards.archivedAt), like(cards.name, '%[%')));
    let moved = 0, mergedStrays = 0, archivedStrays = 0;
    for (const stray of strays) {
      const m = stray.name.match(/^(.*?)\s*\[(.+?)\]\s*$/);
      const cleanName = m ? m[1].trim() : stray.name;
      const suffix = m ? BRACKET_TO_SUFFIX[m[2].trim()] : undefined;
      const targetSetId = suffix ? bySuffix.get(suffix) : undefined;
      if (!targetSetId) {
        await repointAndArchive(tx, stray.id, stray.id, 'TCMS 2025 fix: unmappable parallel stray in base set');
        archivedStrays++;
        continue;
      }
      const [occupied] = await tx.select({ id: cards.id })
        .from(cards)
        .where(and(eq(cards.setId, targetSetId), eq(cards.cardNumber, stray.cardNumber), isNull(cards.archivedAt)));
      if (occupied) {
        await repointAndArchive(tx, stray.id, occupied.id, 'TCMS 2025 fix: duplicate of existing parallel card');
        mergedStrays++;
      } else {
        await tx.update(cards).set({ setId: targetSetId, name: cleanName }).where(eq(cards.id, stray.id));
        moved++;
      }
    }

    // ── 2. Dedupe/rename "Name #S-N" rows in The Snap Variations ───────────
    const snapSetId = bySuffix.get('the-snap-variations');
    let snapRenamed = 0, snapMerged = 0;
    if (snapSetId) {
      const suffixed = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
        .from(cards)
        .where(and(eq(cards.setId, snapSetId), isNull(cards.archivedAt), sql`${cards.name} ~ ' #S-[0-9]+$'`));
      for (const c of suffixed) {
        const cleanName = c.name.replace(/\s*#S-[0-9]+$/, '').trim();
        const [dup] = await tx.select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.setId, snapSetId), eq(cards.cardNumber, c.cardNumber), eq(cards.name, cleanName), isNull(cards.archivedAt)));
        if (dup) {
          await repointAndArchive(tx, c.id, dup.id, 'TCMS 2025 fix: duplicate Snap Variations row');
          snapMerged++;
        } else {
          await tx.update(cards).set({ name: cleanName }).where(eq(cards.id, c.id));
          snapRenamed++;
        }
      }
    }

    // ── 2b. Archive off-checklist duplicates in base + Snap ────────────────
    // e.g. three "B-15" rows squatting on Snap #15 (checklist: Dr. Jane
    // Foster). Only rows whose number maps to a different checklist name AND
    // where the correctly named row also exists; collections/wishlists get
    // repointed to the correct row first.
    const nameByNum = new Map(CHECKLIST.map(e => [String(e.n), e.name]));
    let offChecklist = 0;
    for (const suffix of ['base', 'the-snap-variations']) {
      const setId = bySuffix.get(suffix);
      if (!setId) continue;
      const rows = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
        .from(cards)
        .where(and(eq(cards.setId, setId), isNull(cards.archivedAt)));
      const byNumName = new Map(rows.map(r => [`${r.cardNumber}|${r.name}`, r.id]));
      for (const row of rows) {
        const expected = nameByNum.get(row.cardNumber);
        if (!expected || row.name === expected) continue;
        const correctId = byNumName.get(`${row.cardNumber}|${expected}`);
        if (!correctId || correctId === row.id) continue;
        await repointAndArchive(tx, row.id, correctId, 'TCMS 2025 fix: off-checklist duplicate');
        offChecklist++;
      }
    }
    if (offChecklist > 0) console.log(`[TCMS 2025 Fix] off-checklist duplicates archived: ${offChecklist}`);

    // ── 3. Complete every set to the full 200-card checklist ───────────────
    // Also repairs rows whose name is a hyphen-truncated fragment of the
    // checklist name (an earlier parse split "Star-Lord" into "Star"),
    // guarded to rows without images so real cards are never renamed blindly.
    let inserted = 0, repaired = 0;
    for (const def of FULL_CHECKLIST_SETS) {
      const setId = bySuffix.get(def.suffix);
      if (!setId) continue;
      const existing = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name, frontImageUrl: cards.frontImageUrl })
        .from(cards)
        .where(and(eq(cards.setId, setId), isNull(cards.archivedAt)));
      for (const row of existing) {
        const exp = CHECKLIST.find(e => String(e.n) === row.cardNumber);
        if (!exp || row.name === exp.name) continue;
        // e.g. "She-Hulk [Orange] #S-137" sitting in the Snap Orange
        // Refractor set — right card, decorated name. Strip decorations.
        // Stripping to an exact checklist match is safe even with an image;
        // the riskier hyphen-truncation repair only runs on imageless rows.
        const stripped = row.name.replace(/\s*\[.+?\]\s*/g, ' ').replace(/\s*#S-[0-9]+$/, '').trim();
        if ((exp.name.startsWith(`${row.name}-`) && !row.frontImageUrl) || stripped === exp.name) {
          await tx.update(cards)
            .set({ name: exp.name, description: exp.debut ? `${exp.movie} — Debut` : exp.movie })
            .where(eq(cards.id, row.id));
          repaired++;
        }
      }
      const have = new Set(existing.map(c => c.cardNumber));
      const missing = CHECKLIST.filter(e => !have.has(String(e.n)));
      if (missing.length > 0) {
        await tx.insert(cards).values(missing.map(e => ({
          setId,
          cardNumber: String(e.n),
          name: e.name,
          description: e.debut ? `${e.movie} — Debut` : e.movie,
          isInsert: false,
          rarity: 'Common',
        })));
        inserted += missing.length;
      }
      await tx.update(cardSets)
        .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${setId} AND ${cards.archivedAt} IS NULL)` })
        .where(eq(cardSets.id, setId));
    }

    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER}) ON CONFLICT (name) DO NOTHING`);
    console.log(`[TCMS 2025 Fix] strays moved=${moved} merged=${mergedStrays} archived=${archivedStrays}; snap renamed=${snapRenamed} merged=${snapMerged}; names repaired=${repaired}; cards inserted=${inserted}`);
  });
  console.log('[TCMS 2025 Fix] ✅ 2025 Topps Chrome Marvel Studios checklist complete');
}

import { db } from '../db';
import { cardSets, cards } from '../../shared/schema';
import { eq, and, sql, isNull, like, or } from 'drizzle-orm';

/**
 * One-time idempotent fix: 2025 Topps Chrome Marvel Studios INSERT sets.
 *
 * Follow-up to fixTcms2025Checklist (which fixed the base set + its parallels
 * + The Snap Variations). The remaining TCMS subsets still contain hundreds of
 * rows with the parallel color and/or the card code baked into the name, and
 * many of them were dumped into completely unrelated sets, e.g.:
 *   - "Bullseye [Gold] #DD-9" sitting in Autographs Gold Refractor
 *   - "Alioth [Superfractor] #TVA-1" sitting in Agatha All Along Tarot Cards Superfractor
 *   - "Ego #MG-6" (card_number 6) duplicating the clean "Ego" (card_number MG-6)
 *   - "A jhay [Black]" rows in Sketch Artists (no parallel sets existed)
 *
 * The trailing "#PREFIX-N" code in the name is the source of truth for which
 * insert family a row belongs to; the "[Bracket]" tells us which parallel.
 * Rows are renamed/moved to their correct set + card number, merging into the
 * already-existing clean row when the slot is occupied (collections/wishlists
 * repointed first, images carried over to the survivor when it has none).
 *
 * Safe to run on every startup in dev and prod — matches sets by slug and is
 * gated by a startup_migrations marker written in the same transaction.
 */

const SLUG_PREFIX = '2025-2025-topps-chrome-marvel-studios-';
const NAME_PREFIX = '2025 Topps Chrome Marvel Studios - ';

// Sketch Artists parallels don't exist in the DB yet; create them.
const SKETCH_SETS: Record<string, { suffix: string; name: string }> = {
  Black: { suffix: 'sketch-artists-black', name: 'Sketch Artists Black' },
  Gold: { suffix: 'sketch-artists-gold', name: 'Sketch Artists Gold' },
  Silver: { suffix: 'sketch-artists-silver', name: 'Sketch Artists Silver' },
};

const COLORS: Record<string, string> = { Gold: 'gold', Orange: 'orange', Red: 'red', Black: 'black' };

// For a code family, resolve the slug suffix of the target set given the
// bracket (undefined bracket = the family's base set). Returns null when the
// combination has no known set (caller archives the row).
function familyTargetSuffix(family: string, bracket: string | undefined): string | null {
  switch (family) {
    case 'DD': // Daredevil: Born Again
      if (!bracket) return 'daredevil-born-again';
      if (bracket === 'Superfractor') return 'daredevil-born-again-superfractor';
      return COLORS[bracket] ? `daredevil-born-again-${COLORS[bracket]}-refractor` : null;
    case 'TVA': // TVA Pruning (parallels are "Shimmer" refractors)
      if (!bracket) return 'tva-pruning';
      if (bracket === 'Superfractor') return 'tva-pruning-superfractor';
      return COLORS[bracket] ? `tva-pruning-${COLORS[bracket]}-shimmer-refractor` : null;
    case 'S': // The Snap Variations
      if (!bracket) return 'the-snap-variations';
      if (bracket === 'Superfractor') return 'the-snap-variations-superfractor';
      return COLORS[bracket] ? `the-snap-variations-${COLORS[bracket]}-refractor` : null;
    case 'MG': // Marvel Gods (no parallel sets in DB)
      return bracket ? null : 'marvel-gods';
    case 'AA': // Autographs (letter codes like #AA-GP)
      if (!bracket) return 'autographs';
      if (bracket === 'Superfractor') return 'autographs-superfractor';
      return COLORS[bracket] ? `autographs-${COLORS[bracket]}-refractor` : null;
    case 'AAT': // Agatha All Along Tarot Cards (numeric #AA-N codes)
      if (!bracket) return 'agatha-all-along-tarot-cards';
      if (bracket === 'Superfractor') return 'agatha-all-along-tarot-cards-superfractor';
      return bracket === 'Black' ? 'agatha-all-along-tarot-cards-black-refractor' : null;
    case 'BASE': // main 200-card checklist parallels (rows with numeric card_number, no code)
      if (bracket === 'Superfractor') return 'superfractor';
      return bracket && COLORS[bracket] ? `${COLORS[bracket]}-refractor` : null;
    default:
      return null;
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function repointAndArchive(tx: Tx, fromCardId: number, toCardId: number, reason: string): Promise<void> {
  if (toCardId !== fromCardId) {
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
    // Carry images over to the survivor when it has none.
    await tx.execute(sql`
      UPDATE cards t SET
        front_image_url = COALESCE(t.front_image_url, d.front_image_url),
        back_image_url = COALESCE(t.back_image_url, d.back_image_url)
      FROM cards d
      WHERE t.id = ${toCardId} AND d.id = ${fromCardId}`);
  }
  await tx.update(cards)
    .set({ archivedAt: sql`now()`, archiveReason: reason })
    .where(eq(cards.id, fromCardId));
}

const MARKER = 'tcms_2025_inserts_fix_v1';

export async function fixTcms2025Inserts(): Promise<void> {
  const done = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
  if (((done as any).rows ?? []).length > 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-tcms-2025-inserts'))`);
    const again = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
    if (((again as any).rows ?? []).length > 0) return;

    // All TCMS sets by slug suffix
    const allSets = await tx.select({ id: cardSets.id, slug: cardSets.slug })
      .from(cardSets).where(like(cardSets.slug, `${SLUG_PREFIX}%`));
    const bySuffix = new Map<string, number>();
    for (const row of allSets) bySuffix.set(row.slug.slice(SLUG_PREFIX.length), row.id);
    const suffixBySetId = new Map<number, string>();
    for (const [suffix, id] of bySuffix) suffixBySetId.set(id, suffix);

    // Create the three Sketch Artists parallel sets if missing
    const [mainSet] = await tx.execute(sql`SELECT id FROM main_sets WHERE slug = '2025-topps-chrome-marvel-studios'`)
      .then((r: any) => r.rows as Array<{ id: number }>);
    for (const def of Object.values(SKETCH_SETS)) {
      if (bySuffix.has(def.suffix)) continue;
      const [created] = await tx.insert(cardSets).values({
        name: `${NAME_PREFIX}${def.name}`,
        slug: `${SLUG_PREFIX}${def.suffix}`,
        year: 2025,
        mainSetId: mainSet?.id ?? null,
        isActive: true,
        isCanonical: true,
        totalCards: 0,
      }).onConflictDoNothing({ target: cardSets.slug }).returning({ id: cardSets.id });
      if (created) {
        bySuffix.set(def.suffix, created.id);
        suffixBySetId.set(created.id, def.suffix);
      }
    }

    // All decorated, unarchived rows in any TCMS set
    const setIds = allSets.map(s => s.id);
    const decorated = await tx.select({
      id: cards.id, setId: cards.setId, cardNumber: cards.cardNumber, name: cards.name,
    })
      .from(cards)
      .where(and(
        sql`${cards.setId} IN (SELECT id FROM ${cardSets} WHERE ${cardSets.slug} LIKE ${`${SLUG_PREFIX}%`})`,
        isNull(cards.archivedAt),
        or(like(cards.name, '%[%'), sql`${cards.name} ~ '#[A-Za-z]+-[A-Za-z0-9]+$'`),
      ))
      .orderBy(cards.id);

    // Lazily-loaded occupancy per target set: card_number -> id, name -> id
    const occByNum = new Map<number, Map<string, number>>();
    const occByName = new Map<number, Map<string, number>>();
    async function loadOcc(setId: number) {
      if (occByNum.has(setId)) return;
      const rows = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
        .from(cards).where(and(eq(cards.setId, setId), isNull(cards.archivedAt)));
      const byNum = new Map<string, number>(); const byName = new Map<string, number>();
      for (const r of rows) {
        if (!byNum.has(r.cardNumber)) byNum.set(r.cardNumber, r.id);
        if (!byName.has(r.name)) byName.set(r.name, r.id);
      }
      occByNum.set(setId, byNum); occByName.set(setId, byName);
    }

    const touchedSets = new Set<number>();
    let moved = 0, renamed = 0, merged = 0, archived = 0;

    for (const row of decorated) {
      const m = row.name.match(/^(.*?)\s*(?:\[([^\]]+)\])?\s*(?:#([A-Za-z]+)-([A-Za-z0-9]+))?\s*$/);
      const cleanName = (m?.[1] ?? row.name).trim();
      const bracket = m?.[2]?.trim();
      const codePrefix = m?.[3];
      const codeSuffix = m?.[4];
      const currentSuffix = suffixBySetId.get(row.setId) ?? '';

      let family: string | null = null;
      let targetNumber = row.cardNumber;
      if (codePrefix && codeSuffix) {
        if (codePrefix === 'S' && /^[0-9]+$/.test(codeSuffix)) {
          family = 'S';
          targetNumber = codeSuffix; // Snap sets use plain numeric card numbers
        } else if (codePrefix === 'AA') {
          family = /^[0-9]+$/.test(codeSuffix) ? 'AAT' : 'AA';
          targetNumber = `AA-${codeSuffix}`;
        } else if (codePrefix === 'CC') {
          // Both Content Capture sets share #CC codes — keep the row in its
          // current set (rename only), since the set disambiguates it.
          family = currentSuffix.startsWith('thunderbolts-content-capture') && !bracket ? 'CC' : null;
          targetNumber = `CC-${codeSuffix}`;
        } else if (['DD', 'TVA', 'MG'].includes(codePrefix)) {
          family = codePrefix;
          targetNumber = `${codePrefix}-${codeSuffix}`;
        }
      } else if (bracket && currentSuffix === 'sketch-artists' && SKETCH_SETS[bracket]) {
        family = 'SKETCH';
      } else if (bracket && /^[0-9]+$/.test(row.cardNumber)) {
        // e.g. "Erik Killmonger [Gold]" #85 — a main-checklist parallel
        family = 'BASE';
      }

      // Resolve target set
      let targetSetId: number | undefined;
      let matchBy: 'num' | 'name' = 'num';
      if (family === 'CC') {
        targetSetId = row.setId;
      } else if (family === 'SKETCH') {
        targetSetId = bySuffix.get(SKETCH_SETS[bracket!].suffix);
        matchBy = 'name';
      } else if (family) {
        const suffix = familyTargetSuffix(family, bracket);
        targetSetId = suffix ? bySuffix.get(suffix) : undefined;
      }

      if (!targetSetId || !cleanName) {
        await repointAndArchive(tx, row.id, row.id, 'TCMS 2025 inserts fix: unmappable decorated row');
        archived++;
        touchedSets.add(row.setId);
        continue;
      }

      await loadOcc(targetSetId);
      const occupant = matchBy === 'name'
        ? occByName.get(targetSetId)!.get(cleanName)
        : occByNum.get(targetSetId)!.get(targetNumber);

      if (occupant && occupant !== row.id) {
        await repointAndArchive(tx, row.id, occupant, 'TCMS 2025 inserts fix: duplicate of existing card');
        merged++;
      } else {
        await tx.update(cards)
          .set({ setId: targetSetId, name: cleanName, cardNumber: targetNumber })
          .where(eq(cards.id, row.id));
        occByNum.get(targetSetId)!.set(targetNumber, row.id);
        occByName.get(targetSetId)!.set(cleanName, row.id);
        if (targetSetId === row.setId) renamed++; else moved++;
      }
      touchedSets.add(row.setId);
      touchedSets.add(targetSetId);
    }

    // Refresh totalCards on every touched set
    for (const setId of touchedSets) {
      await tx.update(cardSets)
        .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${setId} AND ${cards.archivedAt} IS NULL)` })
        .where(eq(cardSets.id, setId));
    }

    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER}) ON CONFLICT (name) DO NOTHING`);
    console.log(`[TCMS 2025 Inserts Fix] moved=${moved} renamed=${renamed} merged=${merged} archived=${archived}; sets touched=${touchedSets.size}`);
  });
  console.log('[TCMS 2025 Inserts Fix] ✅ 2025 Topps Chrome Marvel Studios insert sets cleaned');
}

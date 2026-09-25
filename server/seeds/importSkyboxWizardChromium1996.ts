import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';
import checklist from './data/skybox-wizard-chromium-1996.json';

const slug = '1996-skybox-wizard-chromium';
const name = '1996 Skybox Wizard Chromium';
const subsetSlug = `${slug}-series-4`;
const marker = 'import_skybox_wizard_chromium_1996';
// Uploaded attachment bytes via server/cloudinary (no remote URL fetch).
// crop:limit preserves the original 498×698 artwork; optimized JPEG, 77,082 bytes.
const image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1790345456/image-admin/catalog-imports/1996-skybox-wizard-chromium/dxabbqhbyakrybjixlmj.jpg';

/** Add-only, atomic checklist import. Completion marker protects later admin edits. */
export async function importSkyboxWizardChromium1996(database: Pick<typeof db, 'transaction'> = db) {
  if (checklist.length !== 20 || checklist.some((c, i) => c.number !== String(i + 1)) ||
      checklist[7].name !== 'Spider-Man') throw new Error('Wizard Chromium checklist mismatch');
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name = ${marker}`);
    if (done.rows.length) return { imported: false, inserted: 0 };

    // Reject alternate identities rather than creating a second set beside one.
    const candidates = await tx.execute(sql`
      SELECT id, slug FROM main_sets
      WHERE lower(name) = lower(${name}) OR lower(name) LIKE '%wizard%chromium%'
        OR slug = ${slug}`);
    if (candidates.rows.some(row => row.slug !== slug)) {
      throw new Error('Wizard Chromium main-set identity conflict');
    }
    let [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, slug));
    if (main && (main.name !== name || !main.isActive || main.archivedAt ||
        (main.thumbnailImageUrl && main.thumbnailImageUrl !== image))) {
      throw new Error('Wizard Chromium existing main-set conflict');
    }
    if (!main) {
      [main] = await tx.insert(mainSets).values({
        name, slug, thumbnailImageUrl: image,
        isActive: true, isCanonical: true, canonicalSource: 'csv_master',
      }).returning();
    } else if (!main.thumbnailImageUrl) {
      await tx.update(mainSets).set({ thumbnailImageUrl: image }).where(eq(mainSets.id, main.id));
    }
    let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, subsetSlug));
    if (set && (set.mainSetId !== main.id || set.name !== 'Series 4' || set.year !== 1996 ||
        set.isInsertSubset || !set.isActive || set.archivedAt)) {
      throw new Error('Wizard Chromium Series 4 identity conflict');
    }
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    if (children.some(child => child.slug !== subsetSlug)) {
      throw new Error('Unexpected Wizard Chromium subset');
    }
    if (!set) {
      [set] = await tx.insert(cardSets).values({
        name: 'Series 4', slug: subsetSlug, mainSetId: main.id, year: 1996,
        imageUrl: image, totalCards: 20, isInsertSubset: false,
        isActive: true, isCanonical: true, canonicalSource: 'csv_master',
      }).returning();
    }
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const expected = new Map(checklist.map(c => [c.number, c]));
    const seen = new Set<string>();
    for (const card of existing) {
      const row = expected.get(card.cardNumber);
      if (!row || seen.has(card.cardNumber) || card.name !== row.name || card.isInsert ||
          card.archivedAt || (card.description && card.description !== row.details)) {
        throw new Error(`Wizard Chromium card identity conflict: ${card.cardNumber}`);
      }
      seen.add(card.cardNumber);
      if (!card.description) {
        await tx.update(cards).set({ description: row.details }).where(eq(cards.id, card.id));
      }
    }
    const missing = checklist.filter(c => !seen.has(c.number));
    if (missing.length) {
      await tx.insert(cards).values(missing.map(c => ({
        setId: set.id, cardNumber: c.number, name: c.name, description: c.details,
        rarity: 'Common', isInsert: false,
      })));
    }
    const [spider] = await tx.select().from(cards)
      .where(and(eq(cards.setId, set.id), eq(cards.cardNumber, '8'), eq(cards.name, 'Spider-Man')));
    if (!spider || (spider.frontImageUrl && spider.frontImageUrl !== image)) {
      throw new Error('Wizard Chromium Spider-Man image conflict');
    }
    if (!spider.frontImageUrl) {
      // Dedicated audited image assignment; never overwrite an existing image.
      // Same optimistic condition + atomic audit contract as Image Admin.
      const [updated] = await tx.update(cards).set({ frontImageUrl: image })
        .where(and(eq(cards.id, spider.id), isNull(cards.frontImageUrl))).returning();
      if (!updated) throw new Error('Wizard Chromium image changed during import');
      await tx.insert(adminAuditLogs).values({
        actionType: 'card_image_update', entityType: 'card', entityId: spider.id,
        entityName: 'Spider-Man #8',
        notes: JSON.stringify({
          source: marker, attachment: 'image_1790345263741.png',
          sides: ['front'], oldFrontImageUrl: null, newFrontImageUrl: image,
        }),
      });
    }
    await tx.update(cardSets).set({ totalCards: 20 }).where(eq(cardSets.id, set.id));
    const finalCards = await tx.select().from(cards).where(eq(cards.setId, set.id));
    if (finalCards.length !== 20) throw new Error('Wizard Chromium terminal checklist mismatch');
    await tx.insert(adminAuditLogs).values({
      actionType: marker, entityType: 'main_set', entityId: main.id, entityName: name,
      notes: JSON.stringify({ source: '1996_Wizard_Series_4_Chromium_-_Sheet1_(1)_1790345293877.csv',
        subsets: 1, cards: 20, inserted: missing.length, thumbnail: image }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${marker})`);
    return { imported: true, inserted: missing.length, mainSetId: main.id, setId: set.id };
  });
}
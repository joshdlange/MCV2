import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from './data/topps-vault-marvel-2026.json';

const slug = '2026-topps-vault-marvel';
const name = '2026 Topps Vault Marvel';
const marker = 'import_topps_vault_marvel_2026';
const thumbnail = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1790178770/main-set-thumbnails/2026-topps-vault-marvel.png';
const subsetSlug = (label: string) =>
  `${slug}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/**
 * Add-only catalog import from the supplied checklist. All data and its completion
 * marker commit together; an identity conflict fails rather than moving cards.
 */
export async function importToppsVaultMarvel2026() {
  if (checklist.length !== 74 || checklist.reduce((n, s) => n + s.cards.length, 0) !== 1417) {
    throw new Error('Topps Vault checklist count mismatch');
  }
  if (new Set(checklist.map(s => subsetSlug(s.name))).size !== checklist.length) {
    throw new Error('Topps Vault subset slug collision');
  }
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name = ${marker}`);
    if (done.rows.length) return { imported: false };

    let [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, slug));
    if (main && (main.name !== name || !main.isActive || main.archivedAt)) {
      throw new Error('Topps Vault main-set identity conflict');
    }
    if (!main) {
      [main] = await tx.insert(mainSets).values({
        name, slug, thumbnailImageUrl: thumbnail,
        isActive: true, isCanonical: true, canonicalSource: 'csv_master',
      }).returning();
    } else if (!main.thumbnailImageUrl) {
      await tx.update(mainSets).set({ thumbnailImageUrl: thumbnail }).where(eq(mainSets.id, main.id));
    }

    for (const subset of checklist) {
      const key = subsetSlug(subset.name);
      if (new Set(subset.cards.map(c => c.number)).size !== subset.cards.length) {
        throw new Error(`Duplicate checklist card number in ${subset.name}`);
      }
      let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, key));
      if (set && (set.mainSetId !== main.id || set.name !== subset.name ||
          set.year !== 2026 || !set.isActive || set.archivedAt ||
          set.isInsertSubset !== subset.isInsert)) {
        throw new Error(`Topps Vault subset identity conflict: ${subset.name}`);
      }
      if (!set) {
        [set] = await tx.insert(cardSets).values({
          name: subset.name, slug: key, year: 2026, mainSetId: main.id,
          isActive: true, isCanonical: true, canonicalSource: 'csv_master',
          isInsertSubset: subset.isInsert, totalCards: subset.cards.length,
        }).returning();
      }
      const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
      const expected = new Map(subset.cards.map(c => [c.number, c.name]));
      const seen = new Set<string>();
      for (const card of existing) {
        if (seen.has(card.cardNumber) || expected.get(card.cardNumber) !== card.name ||
            card.isInsert !== subset.isInsert || card.archivedAt) {
          throw new Error(`Topps Vault existing-card conflict: ${subset.name}/${card.cardNumber}`);
        }
        seen.add(card.cardNumber);
      }
      const missing = subset.cards.filter(c => !seen.has(c.number));
      if (missing.length) {
        await tx.insert(cards).values(missing.map(c => ({
          setId: set.id, cardNumber: c.number, name: c.name,
          rarity: 'Common', isInsert: subset.isInsert,
        })));
      }
      await tx.update(cardSets).set({ totalCards: subset.cards.length })
        .where(and(eq(cardSets.id, set.id), eq(cardSets.mainSetId, main.id)));
    }
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    if (children.length !== checklist.length) throw new Error('Unexpected Topps Vault subsets');
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${marker})`);
    console.log('Imported 2026 Topps Vault Marvel: 74 subsets, 1417 cards.');
    return { imported: true };
  });
}
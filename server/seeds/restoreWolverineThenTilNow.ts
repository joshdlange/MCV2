import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { mainSets, cardSets, cards, adminAuditLogs } from "../../shared/schema";
import checklist from "./data/wolverine-then-til-now-i-1991.json";

export const wolverineCatalog = {
  marker: "restore_wolverine_then_til_now_owner_checklist",
  firstSlug: "1991-comic-images-wolverine-from-then-til-now-i",
  secondSlug: "marvel-1992-comic-images-wolverine-from-then-til-now-ii",
  firstName: "1991 Comic Images Wolverine From Then 'Til Now I",
  secondName: "1992 Comic Images Wolverine From Then 'Til Now II",
  firstThumbnail: "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795276734/image-admin/catalog-imports/wolverine-then-til-now/series-i-box.png",
  secondThumbnail: "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795276736/image-admin/catalog-imports/wolverine-then-til-now/series-ii-box.png",
  card90: "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795276736/image-admin/catalog-imports/wolverine-then-til-now/series-ii-card-90.png",
};

/** Restore existing identities; never merge/delete collector-owned cards. One-time owner-approved images. */
export async function restoreWolverineThenTilNow(database: Pick<typeof db, "transaction"> = db) {
  const config = wolverineCatalog;
  if (checklist.length !== 45 || checklist.some((row, i) => row.number !== String(i + 1))) {
    throw new Error("Series I owner checklist must be exactly 1–45");
  }
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${config.marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${config.marker}`);
    if (done.rows.length) return { applied: false };

    const [second] = await tx.select().from(mainSets).where(eq(mainSets.slug, config.secondSlug)).for("update");
    if (!second || !/1992.*wolverine.*then.*now.*ii/i.test(second.name)) throw new Error("Series II identity conflict");
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, second.id)).for("update");
    const base = children.find(row => row.slug === config.secondSlug);
    const prism = children.find(row => row.slug === `${config.secondSlug}-prism`);
    if (children.length !== 2 || !base || !prism || children.some(row => row.year !== 1992)) {
      throw new Error("Series II subset conflict");
    }
    const baseCards = await tx.select().from(cards).where(eq(cards.setId, base.id)).for("update");
    const prismCards = await tx.select().from(cards).where(eq(cards.setId, prism.id)).for("update");
    const hasExactNumbers = (rows: typeof baseCards, expected: string[]) =>
      rows.length === expected.length && new Set(rows.map(row => row.cardNumber)).size === expected.length &&
      rows.every(row => expected.includes(row.cardNumber) && !row.archivedAt);
    if (!hasExactNumbers(baseCards, Array.from({ length: 90 }, (_, i) => String(i + 1))) ||
        !hasExactNumbers(prismCards, Array.from({ length: 6 }, (_, i) => `P${i + 1}`))) {
      throw new Error("Series II checklist differs from the verified 90 base / 6 Prism cards");
    }
    const card90 = baseCards.find(row => row.cardNumber === "90")!;
    if (card90.name.toLowerCase() !== "checklist") throw new Error("Series II card 90 is not Checklist");

    // Reject alternate identities rather than accidentally create a second Series I.
    const alternatives = await tx.execute(sql`SELECT id FROM main_sets
      WHERE name ILIKE '%1991%' AND (name ILIKE '%wolverine%' OR name ILIKE '%then%now%')
        AND slug <> ${config.firstSlug}`);
    if (alternatives.rows.length) throw new Error("Possible Series I duplicate requires review");
    let [first] = await tx.select().from(mainSets).where(eq(mainSets.slug, config.firstSlug)).for("update");
    if (first && first.name !== config.firstName) throw new Error("Series I master identity conflict");
    if (!first) {
      [first] = await tx.insert(mainSets).values({
        slug: config.firstSlug, name: config.firstName, isActive: true, isCanonical: true,
        canonicalSource: "Owner-provided 45-card checklist",
        thumbnailImageUrl: config.firstThumbnail,
      }).returning();
    }
    const firstChildren = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, first.id)).for("update");
    if (firstChildren.length > 1) throw new Error("Series I must contain only a base subset");
    let firstBase = firstChildren[0];
    if (firstBase && (firstBase.slug !== `${config.firstSlug}-base` || firstBase.year !== 1991 || firstBase.isInsertSubset)) {
      throw new Error("Series I base identity conflict");
    }
    if (!firstBase) {
      [firstBase] = await tx.insert(cardSets).values({
        slug: `${config.firstSlug}-base`, name: "Base", year: 1991, mainSetId: first.id,
        totalCards: 45, isActive: true, isCanonical: true, isInsertSubset: false,
        canonicalSource: "Owner-provided 45-card checklist",
      }).returning();
    }
    const existing = await tx.select().from(cards).where(eq(cards.setId, firstBase.id));
    const seen = new Set<string>();
    for (const row of existing) {
      const expected = checklist.find(item => item.number === row.cardNumber);
      if (!expected || row.name !== expected.name || row.isInsert || row.archivedAt || seen.has(row.cardNumber)) {
        throw new Error(`Series I card identity conflict at ${row.cardNumber}`);
      }
      seen.add(row.cardNumber);
    }
    const missing = checklist.filter(row => !seen.has(row.number));
    if (missing.length) await tx.insert(cards).values(missing.map(row => ({
      setId: firstBase.id, cardNumber: row.number, name: row.name, rarity: "Common", isInsert: false,
    })));
    await tx.update(mainSets).set({
      isActive: true, isCanonical: true, archivedAt: null, thumbnailImageUrl: config.firstThumbnail,
    }).where(eq(mainSets.id, first.id));
    await tx.update(cardSets).set({
      name: "Base", totalCards: 45, isActive: true, isCanonical: true, archivedAt: null,
    }).where(eq(cardSets.id, firstBase.id));
    await tx.update(mainSets).set({
      name: config.secondName, isActive: true, isCanonical: true, archivedAt: null,
      thumbnailImageUrl: config.secondThumbnail,
    }).where(eq(mainSets.id, second.id));
    for (const [subset, name, total] of [[base, "Base", 90], [prism, "Prism", 6]] as const) {
      await tx.update(cardSets).set({
        name, isActive: true, isCanonical: true, archivedAt: null, totalCards: total,
        isInsertSubset: subset.id === prism.id,
      }).where(eq(cardSets.id, subset.id));
    }
    if (card90.frontImageUrl !== config.card90) {
      await tx.update(cards).set({ frontImageUrl: config.card90 }).where(eq(cards.id, card90.id));
      await tx.insert(adminAuditLogs).values({
        actionType: "card_image_update", entityType: "card", entityId: card90.id, entityName: "Checklist #90",
        notes: JSON.stringify({ source: config.marker, sides: ["front"], attachment: "image_1795276425438.png",
          oldFrontImageUrl: card90.frontImageUrl, newFrontImageUrl: config.card90 }),
      });
    }
    await tx.insert(adminAuditLogs).values({
      actionType: config.marker, entityType: "main_set", entityId: second.id, entityName: config.secondName,
      notes: JSON.stringify({ restoredCards: 96, addedSeriesI: 45, inserted: missing.length,
        previousName: second.name, previousThumbnail: second.thumbnailImageUrl }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${config.marker})`);
    return { applied: true, firstMainSetId: first.id, secondMainSetId: second.id, inserted: missing.length };
  });
}

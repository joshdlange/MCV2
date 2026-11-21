import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { cards, cardSets, mainSets, adminAuditLogs } from "../../shared/schema";

export const buybackCountRepair = {
  marker: "correct_2016_masterpieces_autograph_buybacks_count",
  slug: "2016-2016-upper-deck-marvel-masterpieces-1992-marvel-masterpieces-autograph-buybacks",
};

/** Count-only correction, verified against the published 99-card checklist. */
export async function correctMasterpiecesBuybackCount(database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async tx => {
    const { marker, slug } = buybackCountRepair;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { applied: false };
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug)).for("update");
    if (!set || set.year !== 2016 || !set.mainSetId) throw new Error("Buybacks subset identity conflict");
    const [master] = await tx.select().from(mainSets).where(eq(mainSets.id, set.mainSetId));
    if (master?.slug !== "2016-upper-deck-marvel-masterpieces") throw new Error("Buybacks master identity conflict");
    const rows = await tx.select().from(cards).where(eq(cards.setId, set.id)).for("update");
    if (rows.length !== 99 || new Set(rows.map(c => c.cardNumber)).size !== 99 ||
        rows.some(c => c.archivedAt || !/^[1-9][0-9]?$/.test(c.cardNumber))) {
      throw new Error("Buybacks must contain exactly cards 1–99");
    }
    await tx.update(cardSets).set({ totalCards: 99 }).where(eq(cardSets.id, set.id));
    await tx.insert(adminAuditLogs).values({
      actionType: marker, entityType: "card_set", entityId: set.id, entityName: set.name,
      notes: JSON.stringify({ oldTotal: set.totalCards, newTotal: 99, actualCards: rows.length,
        source: "https://www.cardboardconnection.com/2016-upper-deck-marvel-masterpieces" }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { applied: true, previousCount: set.totalCards, count: 99 };
  });
}

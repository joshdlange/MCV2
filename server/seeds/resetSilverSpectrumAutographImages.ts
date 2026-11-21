import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { cards, cardSets, adminAuditLogs } from "../../shared/schema";
import { manualImageOnlySlug } from "../services/automaticImagePolicy";

export const silverImageRepair = {
  marker: "owner_reset_2016_silver_spectrum_autograph_images",
  images: {
    "3": "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795278619/image-admin/catalog-imports/masterpieces-2016-silver-autograph/fin-fang-3.png",
    "4": "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795278619/image-admin/catalog-imports/masterpieces-2016-silver-autograph/werewolf-4.png",
  } as Record<string, string>,
};

export async function resetSilverSpectrumAutographImages(database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async tx => {
    const { marker, images } = silverImageRepair;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { applied: false };
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, manualImageOnlySlug)).for("update");
    if (!set || set.year !== 2016 || !/Silver Spectrum Autograph$/.test(set.name)) throw new Error("Subset identity conflict");
    const rows = await tx.select().from(cards).where(eq(cards.setId, set.id)).for("update");
    if (rows.length !== 90 || new Set(rows.map(c => c.cardNumber)).size !== 90 ||
        rows.some(c => c.archivedAt || !/^(?:[1-9]|[1-8][0-9]|90)$/.test(c.cardNumber)) ||
        !/Fin Fang/i.test(rows.find(c => c.cardNumber === "3")?.name ?? "") ||
        !/Werewolf/i.test(rows.find(c => c.cardNumber === "4")?.name ?? "")) {
      throw new Error("Expected 90-card checklist with Fin Fang #3 and Werewolf #4");
    }
    for (const card of rows) {
      const front = images[card.cardNumber] ?? null;
      await tx.update(cards).set({ frontImageUrl: front, backImageUrl: null, alternateImages: null })
        .where(eq(cards.id, card.id));
      await tx.insert(adminAuditLogs).values({
        actionType: "card_image_update", entityType: "card", entityId: card.id, entityName: card.name,
        notes: JSON.stringify({ source: marker, operation: front ? "owner_replacement" : "owner_clear",
          sides: [...(card.frontImageUrl !== front ? ["front"] : []), ...(card.backImageUrl ? ["back"] : [])],
          oldFrontImageUrl: card.frontImageUrl, oldBackImageUrl: card.backImageUrl,
          oldAlternateImages: card.alternateImages, newFrontImageUrl: front, newBackImageUrl: null }),
      });
    }
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { applied: true, cards: rows.length, images: 2 };
  });
}

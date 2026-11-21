import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { cards, cardSets, mainSets, adminAuditLogs } from "../../shared/schema";
import { redSpectrumManualImageSlug } from "../services/automaticImagePolicy";

export const redImageRepair = {
  marker: "owner_reset_2016_red_spectrum_foil_images",
  images: {
    "4": "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795279011/image-admin/catalog-imports/masterpieces-2016-red-spectrum/werewolf-4.png",
    "75": "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795279012/image-admin/catalog-imports/masterpieces-2016-red-spectrum/jean-grey-75.png",
  } as Record<string, string>,
};

export async function resetRedSpectrumImages(database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async tx => {
    const { marker, images } = redImageRepair;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { applied: false };
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, redSpectrumManualImageSlug)).for("update");
    if (!set || set.year !== 2016 || !/Red Spectrum Foil$/.test(set.name) || !set.mainSetId) {
      throw new Error("Red Spectrum subset identity conflict");
    }
    const [master] = await tx.select().from(mainSets).where(eq(mainSets.id, set.mainSetId));
    if (master?.slug !== "2016-upper-deck-marvel-masterpieces") throw new Error("Red Spectrum master identity conflict");
    const rows = await tx.select().from(cards).where(eq(cards.setId, set.id)).for("update");
    if (rows.length !== 90 || new Set(rows.map(c => c.cardNumber)).size !== 90 ||
        rows.some(c => c.archivedAt || !/^(?:[1-9]|[1-8][0-9]|90)$/.test(c.cardNumber)) ||
        !/Werewolf/i.test(rows.find(c => c.cardNumber === "4")?.name ?? "") ||
        !/Jean Grey/i.test(rows.find(c => c.cardNumber === "75")?.name ?? "")) {
      throw new Error("Expected 90-card checklist with Werewolf #4 and Jean Grey #75");
    }
    let changed = 0;
    for (const card of rows) {
      const front = images[card.cardNumber] ?? null;
      if (card.frontImageUrl === front && !card.backImageUrl && !card.alternateImages) continue;
      await tx.update(cards).set({ frontImageUrl: front, backImageUrl: null, alternateImages: null })
        .where(eq(cards.id, card.id));
      await tx.insert(adminAuditLogs).values({
        actionType: "card_image_update", entityType: "card", entityId: card.id, entityName: card.name,
        notes: JSON.stringify({ source: marker, operation: front ? "owner_replacement" : "owner_clear",
          sides: [...(card.frontImageUrl !== front ? ["front"] : []), ...(card.backImageUrl ? ["back"] : [])],
          oldFrontImageUrl: card.frontImageUrl, oldBackImageUrl: card.backImageUrl,
          oldAlternateImages: card.alternateImages, newFrontImageUrl: front, newBackImageUrl: null }),
      });
      changed++;
    }
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { applied: true, cards: rows.length, images: 2, changed };
  });
}

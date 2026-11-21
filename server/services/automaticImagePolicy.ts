import { db } from "../db";
import { sql } from "drizzle-orm";

// Owner-cleared checklist: only reviewed/manual image assignments are allowed.
export const manualImageOnlySlug = "2016-2016-upper-deck-marvel-masterpieces-silver-spectrum-autograph";

export async function assertAutomaticImageAllowed(cardId: number) {
  const result = await db.execute(sql`SELECT s.slug FROM cards c
    JOIN card_sets s ON s.id=c.set_id WHERE c.id=${cardId}`);
  if (!result.rows.length) throw new Error("Card not found");
  if (result.rows[0].slug === manualImageOnlySlug) {
    throw new Error("This subset requires manually approved images");
  }
}

/** Recheck protection at write time, including requests started before a repair. */
export async function saveAutomaticImage(cardId: number, url: string): Promise<boolean> {
  const result = await db.execute(sql`UPDATE cards c SET front_image_url=${url}
    FROM card_sets s WHERE s.id=c.set_id AND c.id=${cardId}
      AND s.slug <> ${manualImageOnlySlug}
    RETURNING c.id`);
  return result.rows.length === 1;
}

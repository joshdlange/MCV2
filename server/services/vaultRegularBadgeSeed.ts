import { sql } from "drizzle-orm";
import { db } from "../db";

export const VAULT_REGULAR_BADGE_NAME = "Vault Regular";
export const VAULT_REGULAR_BADGE_DESCRIPTION =
  "Came back to the vault 4 times on mobile.";
export const VAULT_REGULAR_BADGE_ICON =
  "/uploads/badges/vault-regular.png";

export async function seedVaultRegularBadge(): Promise<{ ran: boolean; reason: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917205)`);

    const existing: any = await tx.execute(sql`
      SELECT id, description, icon_url, requirement
      FROM badges
      WHERE name = ${VAULT_REGULAR_BADGE_NAME}
      LIMIT 1
    `);
    const row = (existing.rows ?? existing)[0];
    const requirement = JSON.stringify({
      type: "native_mobile_login",
      count: 4,
      key: "vault_regular",
    });

    if (row) {
      if (
        row.description !== VAULT_REGULAR_BADGE_DESCRIPTION ||
        row.icon_url !== VAULT_REGULAR_BADGE_ICON ||
        row.requirement !== requirement
      ) {
        await tx.execute(sql`
          UPDATE badges
          SET description = ${VAULT_REGULAR_BADGE_DESCRIPTION},
              icon_url = ${VAULT_REGULAR_BADGE_ICON},
              requirement = ${requirement},
              unlock_hint = ${"Open the native mobile app 4 times"},
              is_active = true
          WHERE id = ${row.id}
        `);
        return { ran: true, reason: "badge updated" };
      }
      return { ran: false, reason: "already seeded" };
    }

    await tx.execute(sql`
      INSERT INTO badges (
        name, description, icon_url, category, requirement,
        rarity, points, unlock_hint, is_active
      )
      VALUES (
        ${VAULT_REGULAR_BADGE_NAME},
        ${VAULT_REGULAR_BADGE_DESCRIPTION},
        ${VAULT_REGULAR_BADGE_ICON},
        ${"Achievement"},
        ${requirement},
        ${"gold"},
        ${25},
        ${"Open the native mobile app 4 times"},
        true
      )
    `);
    return { ran: true, reason: "created" };
  });
}
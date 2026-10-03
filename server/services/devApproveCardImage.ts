import { and, eq, isNull } from "drizzle-orm";
import { adminAuditLogs, cards, pendingCardImages, users } from "../../shared/schema";
import { db } from "../db";
import { assertDevScanTelemetryDatabase } from "./devScanTelemetry";
import { prepareDevScanReference, saveDevScanReference } from "./devScanReferenceSave";
import { deleteImageAdminUpload, uploadImageAdminUrl } from "./imageMigration";

/** Actual DEV approval implementation: card, queue decision, vector and audit commit together. */
export async function approveDevCardImage(imageId: number, adminId: number, overrideUrl?: string | null) {
  assertDevScanTelemetryDatabase();
  const [admin] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, adminId));
  if (!admin?.isAdmin) throw Object.assign(new Error("Admin access required"), { statusCode: 403 });
  const [pending] = await db.select().from(pendingCardImages).where(eq(pendingCardImages.id, imageId));
  if (!pending || pending.status !== "pending") throw Object.assign(new Error("Image is not pending"), { statusCode: 409 });
  const [card] = await db.select().from(cards).where(eq(cards.id, pending.cardId));
  if (!card) throw Object.assign(new Error("Card not found"), { statusCode: 404 });
  if (!overrideUrl && !pending.frontImageUrl && !pending.backImageUrl) {
    throw Object.assign(new Error("This report has no photo. Supply a replacement image or reject the report without changing the image."), { statusCode: 400 });
  }
  let imported: Awaited<ReturnType<typeof uploadImageAdminUrl>> | undefined;
  try {
    if (overrideUrl) imported = await uploadImageAdminUrl(overrideUrl, card.id, "front");
    const front = imported?.url ?? pending.frontImageUrl;
    const updates = {
      ...(front ? { frontImageUrl: front } : {}),
      ...(pending.backImageUrl ? { backImageUrl: pending.backImageUrl } : {}),
    };
    const reference = await prepareDevScanReference(front ?? undefined);
    return await db.transaction(async tx => {
      const [locked] = await tx.select().from(pendingCardImages).where(eq(pendingCardImages.id, imageId)).for("update");
      if (locked?.status !== "pending") throw Object.assign(new Error("Already reviewed"), { statusCode: 409 });
      const [updated] = await tx.update(cards).set(updates).where(and(eq(cards.id, card.id),
        card.frontImageUrl ? eq(cards.frontImageUrl, card.frontImageUrl) : isNull(cards.frontImageUrl),
        card.backImageUrl ? eq(cards.backImageUrl, card.backImageUrl) : isNull(cards.backImageUrl))).returning();
      if (!updated) throw Object.assign(new Error("Card changed during approval; reload it"), { statusCode: 409 });
      await saveDevScanReference(tx, card.id, reference);
      await tx.update(pendingCardImages).set({ status: "approved", reviewedBy: adminId, reviewedAt: new Date() }).where(eq(pendingCardImages.id, imageId));
      await tx.insert(adminAuditLogs).values({
        adminUserId: adminId, actionType: "card_image_update", entityType: "card", entityId: card.id,
        entityName: `${card.name} #${card.cardNumber}`,
        notes: JSON.stringify({ source: "photo_approval", pendingImageId: imageId, sides: Object.keys(updates) }),
      });
      return updated;
    });
  } catch (error) {
    if (imported) await deleteImageAdminUpload(imported.publicId);
    throw error;
  }
}
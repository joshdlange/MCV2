/**
 * Real DEV DB + bundled model test of the production-used approval function.
 * NOT authenticated browser, Cloudinary-upload or user-camera acceptance evidence.
 * Own temporary fixtures only; no Firebase identities or production writes.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDevScanTelemetryDatabase } from "../server/services/devScanTelemetry";
import { canAutoApproveCardPhoto, validateWrongImageReason } from "../server/services/cardPhotoReviewPolicy";

async function main() {
  assertDevScanTelemetryDatabase();
  const { db, pool } = await import("../server/db");
  const { users, cards, pendingCardImages } = await import("../shared/schema");
  const { storage } = await import("../server/storage");
  const { approveDevCardImage } = await import("../server/services/devApproveCardImage");
  const { initializeDevScanReferences } = await import("../server/services/devScanReferenceSave");
  await initializeDevScanReferences();
  const fixture = `photo-policy-${randomUUID()}`;
  let cardId: number | undefined;
  const userIds: number[] = [];
  const evidence: Record<string, unknown> = { fixture, scope: "real DEV database and approval/model code, not authenticated browser or upload acceptance" };
  try {
    const [admin] = await db.insert(users).values({ username: `${fixture}-admin`, email: `${fixture}-admin@example.invalid`, firebaseUid: `${fixture}-admin`, isAdmin: true }).returning();
    userIds.push(admin.id);
    const [trusted] = await db.insert(users).values({ username: `${fixture}-trusted`, email: `${fixture}-trusted@example.invalid`, firebaseUid: `${fixture}-trusted`, trustedUploader: true }).returning();
    userIds.push(trusted.id);
    assert.equal(canAutoApproveCardPhoto(trusted), false);
    assert.equal(canAutoApproveCardPhoto(admin), true);
    assert.throws(() => validateWrongImageReason("anything"));
    evidence.adminOnlyBypass = "PASS";
    const set = (await pool.query("SELECT id FROM card_sets WHERE is_active=true AND archived_at IS NULL ORDER BY id LIMIT 1")).rows[0];
    const [card] = await db.insert(cards).values({ name: fixture, cardNumber: "TEST", rarity: "Common", setId: set.id, frontImageUrl: null }).returning();
    cardId = card.id;
    const report = await storage.createPendingCardImage({ userId: trusted.id, cardId, source: "wrong_image:multiple_cards", frontImageUrl: null, backImageUrl: null });
    assert.ok((await storage.getPendingCardImages()).some(p => p.id === report.id));
    await assert.rejects(approveDevCardImage(report.id, admin.id), /no photo/);
    assert.equal((await storage.getPendingCardImage(report.id))?.status, "pending");
    evidence.reasonOnlyQueueAndNoBlindApproval = "PASS";
    const bad = await storage.createPendingCardImage({ userId: trusted.id, cardId, source: "scan_to_add", frontImageUrl: "http://127.0.0.1/private", backImageUrl: null });
    await assert.rejects(approveDevCardImage(bad.id, admin.id));
    assert.equal((await storage.getCard(cardId))?.frontImageUrl, null);
    assert.equal((await storage.getPendingCardImage(bad.id))?.status, "pending");
    evidence.failedPreparationLeavesImageAndQueueUntouched = "PASS";
    const url = "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1749602402/marvel-cards/dkmhwckurdwpna85aaau.jpg";
    const pending = await storage.createPendingCardImage({ userId: trusted.id, cardId, source: "scan_to_add", frontImageUrl: url, backImageUrl: null });
    await assert.rejects(approveDevCardImage(pending.id, trusted.id), /Admin access/);
    const updated = await approveDevCardImage(pending.id, admin.id);
    assert.equal(updated.frontImageUrl, url);
    assert.equal((await storage.getPendingCardImage(pending.id))?.status, "approved");
    const ref = (await pool.query("SELECT image_url,embedding FROM dev_scan_reference_overrides WHERE card_id=$1", [cardId])).rows[0];
    assert.equal(ref.image_url, url);
    assert.equal(ref.embedding.length, 384);
    const audits = await pool.query("SELECT count(*)::int n FROM admin_audit_logs WHERE admin_user_id=$1 AND entity_id=$2 AND action_type='card_image_update'", [admin.id, cardId]);
    assert.equal(audits.rows[0].n, 1);
    await assert.rejects(approveDevCardImage(pending.id, admin.id), /not pending/);
    evidence.realApprovalImageVectorAuditAndReplay = "PASS";
  } finally {
    if (cardId) {
      await pool.query("DELETE FROM pending_card_images WHERE card_id=$1", [cardId]);
      await pool.query("DELETE FROM admin_audit_logs WHERE entity_id=$1 AND admin_user_id=ANY($2::integer[])", [cardId, userIds]);
      await pool.query("DELETE FROM cards WHERE id=$1 AND name=$2", [cardId, fixture]);
    }
    if (userIds.length) await pool.query("DELETE FROM users WHERE id=ANY($1::integer[])", [userIds]);
    await pool.end();
    evidence.temporaryFixturesRemoved = true;
    console.log(JSON.stringify(evidence, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
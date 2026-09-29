import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { repair1994FlairPowerBlast } from "../seeds/mergeDuplicateLegacySets";
import {
  AccountDeletionPendingError,
  accountDeletionRecipientHash,
  deleteAccountPermanently,
  resumeAccountDeletion,
  shouldSuppressAccountDeletionEmailEvent,
  type DeleteAccountOptions,
} from "../services/accountDeletion";
import * as schema from "../../shared/schema";

test("PowerBlast fold snapshots are removed only for the deleted collection owner", async () => {
  const sourceSlug = "1994-1994-flair-marvel-annual-flair-marvel-universe-powerblast";
  const targetSlug = "1994-flair-marvel-annual-flair-marvel-universe-powerblast";
  const tag = `deletion-powerblast-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const names = [
    "Cable", "Cyclops", "Iron Man", "Magneto", "Phoenix", "Storm",
    "Venom", "Wolverine", "Ghost Rider", "Punisher", "Captain America",
    "Gambit", "Thor", "Silver Surfer", "Spider-Man", "Deadpool",
    "Invisible Woman", "Dr. Doom",
  ];
  let fixture: {
    ownerId: number; otherId: number; email: string;
    setIds: number[]; sourceCardIds: number[]; collectionIds: number[];
    renamedSets: Array<{ id: number; slug: string }>;
    privateAuditId: number; otherAuditId: number; malformedAuditId: number;
  } | undefined;

  try {
    fixture = await db.transaction(async (tx) => {
      const originalSets = await tx.select({ id: schema.cardSets.id, slug: schema.cardSets.slug })
        .from(schema.cardSets).where(inArray(schema.cardSets.slug, [sourceSlug, targetSlug]));
      for (const set of originalSets) {
        await tx.update(schema.cardSets).set({ slug: `${tag}-${set.slug}` })
          .where(eq(schema.cardSets.id, set.id));
      }
      const [source, target] = await tx.insert(schema.cardSets).values([
        { slug: sourceSlug, name: `${tag} source`, year: 1994, totalCards: 20 },
        { slug: targetSlug, name: `${tag} target`, year: 1994, totalCards: 18 },
      ]).returning();
      const targets = await tx.insert(schema.cards).values(names.map((name, index) => ({
        setId: target.id, cardNumber: String(index + 1), name, rarity: "Common",
      }))).returning();
      const sources = await tx.insert(schema.cards).values([
        ...names.map((name, index) => ({
          setId: source.id, cardNumber: String(index + 1), name, rarity: "Common",
        })),
        { setId: source.id, cardNumber: "2", name: "Punisher", rarity: "Common" },
        { setId: source.id, cardNumber: "6", name: "Spider-Man", rarity: "Common" },
      ]).returning();
      const [owner, other] = await tx.insert(schema.users).values([
        { firebaseUid: `${tag}-owner`, username: `owner_${tag}`.slice(0, 40),
          email: `${tag}-owner@example.test` },
        { firebaseUid: `${tag}-other`, username: `other_${tag}`.slice(0, 40),
          email: `${tag}-other@example.test` },
      ]).returning();
      const collections = await tx.insert(schema.userCollections).values([
        { userId: owner.id, cardId: targets[9].id, quantity: 1 },
        { userId: owner.id, cardId: sources[18].id, quantity: 2,
          notes: "PRIVATE-owner-note", serialNumber: "PRIVATE-owner-serial",
          personalValue: "987.65" },
        { userId: other.id, cardId: targets[14].id, quantity: 1 },
        { userId: other.id, cardId: sources[19].id, quantity: 3,
          notes: "PRIVATE-other-note", serialNumber: "PRIVATE-other-serial",
          personalValue: "123.45" },
      ]).returning();
      await repair1994FlairPowerBlast(tx);
      const audits = await tx.select().from(schema.adminAuditLogs)
        .where(eq(schema.adminAuditLogs.actionType, "legacy_powerblast_collection_fold"));
      const privateAudit = audits.find(a => a.entityId === collections[1].id);
      const otherAudit = audits.find(a => a.entityId === collections[3].id);
      assert.ok(privateAudit?.notes?.includes("PRIVATE-owner-note"));
      assert.ok(privateAudit.notes.includes("PRIVATE-owner-serial"));
      assert.ok(privateAudit.notes.includes("987.65"));
      assert.ok(otherAudit?.notes?.includes("PRIVATE-other-note"));
      const [malformed] = await tx.insert(schema.adminAuditLogs).values({
        actionType: "legacy_powerblast_collection_fold", entityType: "user_collection",
        entityId: collections[1].id, notes: `{"ownerId":${owner.id},"absorbedRow":`,
      }).returning();
      return {
        ownerId: owner.id, otherId: other.id, email: owner.email,
        setIds: [source.id, target.id], sourceCardIds: sources.map(c => c.id),
        collectionIds: collections.map(c => c.id),
        renamedSets: originalSets,
        privateAuditId: privateAudit.id, otherAuditId: otherAudit.id,
        malformedAuditId: malformed.id,
      };
    });

    const result = await deleteAccountPermanently({
      userId: fixture.ownerId, source: "self_service",
      dependencies: {
        deleteFirebaseUser: async () => {},
        sendNotificationEmail: async () => "sent",
      },
    });
    assert.equal(result.status, "completed");
    const [privateAudit, otherAudit, malformedAudit, mergeAudits] = await Promise.all([
      db.select().from(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.id, fixture.privateAuditId)),
      db.select().from(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.id, fixture.otherAuditId)),
      db.select().from(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.id, fixture.malformedAuditId)),
      db.select().from(schema.adminAuditLogs).where(
        inArray(schema.adminAuditLogs.entityId, fixture.sourceCardIds)),
    ]);
    assert.equal(privateAudit.length, 0, "Deleted owner's absorbed private snapshot must be gone");
    assert.equal(otherAudit.length, 1);
    assert.ok(otherAudit[0].notes?.includes("PRIVATE-other-serial"));
    assert.ok(otherAudit[0].notes?.includes("123.45"));
    assert.equal(malformedAudit.length, 1, "Malformed text JSON must not abort deletion");
    assert.equal(mergeAudits.filter(a => a.actionType === "legacy_powerblast_card_merge").length, 20,
      "Nonpersonal merge audit must remain");
  } finally {
    if (fixture) {
      await db.transaction(async (tx) => {
        await tx.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.id,
          [fixture!.privateAuditId, fixture!.otherAuditId, fixture!.malformedAuditId]));
        await tx.delete(schema.adminAuditLogs).where(
          inArray(schema.adminAuditLogs.entityId, fixture!.sourceCardIds));
        await tx.delete(schema.adminAuditLogs).where(and(
          eq(schema.adminAuditLogs.actionType, "delete_user_account"),
          eq(schema.adminAuditLogs.entityId, fixture!.ownerId),
        ));
        await tx.delete(schema.userCollections).where(eq(schema.userCollections.userId, fixture!.otherId));
        await tx.delete(schema.users).where(inArray(schema.users.id, [fixture!.ownerId, fixture!.otherId]));
        await tx.delete(schema.cards).where(inArray(schema.cards.setId, fixture!.setIds));
        await tx.delete(schema.cardSets).where(inArray(schema.cardSets.id, fixture!.setIds));
        for (const { id, slug } of fixture!.renamedSets) {
          await tx.update(schema.cardSets).set({ slug }).where(eq(schema.cardSets.id, id));
        }
      });
      await db.delete(schema.accountDeletionJobs).where(
        eq(schema.accountDeletionJobs.userId, fixture.ownerId));
      await db.delete(schema.accountDeletionEmailSuppressions).where(eq(
        schema.accountDeletionEmailSuppressions.recipientHash,
        accountDeletionRecipientHash(fixture.email),
      ));
    }
  }
});

test("permanent account deletion removes linked and decoupled user data", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `account-deletion-${suffix}@example.test`;
  const username = `delete_${suffix}`.slice(0, 40);
  const firebaseUid = `delete-firebase-${suffix}`;
  const sentEmails: Array<{
    to: string;
    template?: string;
    skipLog?: boolean;
    idempotencyKey?: string;
  }> = [];
  const deletedFirebaseUids: string[] = [];

  const [otherUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(1);
  assert.ok(otherUser, "The integration test needs one existing user");

  const [created] = await db
    .insert(schema.users)
    .values({ firebaseUid, username, email })
    .returning({ id: schema.users.id });
  assert.ok(created);

  const userId = created.id;

  try {
    await db.insert(schema.emailLogs).values({
      userId,
      email,
      template: "test",
      subject: "test",
      providerMessageId: `provider-${suffix}`,
    });
    await db.insert(schema.emailEvents).values({
      providerMessageId: `provider-${suffix}`,
      eventType: "delivered",
      email,
    });
    await db.insert(schema.analyticsEvents).values({
      userId,
      eventType: "test",
    });
    await db.insert(schema.userScanLogs).values({ userId });
    await db.insert(schema.follows).values({
      followerUserId: userId,
      followingUserId: otherUser.id,
    });
    await db.insert(schema.notifications).values({
      userId,
      type: "test",
      title: "test",
      message: "test",
    });
    await db.insert(schema.xpEvents).values({
      userId,
      eventType: `test-${suffix}`,
      points: 1,
    });
    await db.insert(schema.feedEvents).values({
      userId,
      eventType: "test",
      title: "test",
      dedupeKey: `account-delete-test-${suffix}`,
    });

    const options: DeleteAccountOptions = {
      userId,
      source: "admin",
      actorUserId: otherUser.id,
      actorEmail: "admin@example.test",
      dependencies: {
        deleteFirebaseUser: async (uid) => {
          deletedFirebaseUids.push(uid);
        },
        cancelStripeSubscription: async () => {
          throw new Error("The test account should not have a Stripe subscription");
        },
        sendNotificationEmail: async (emailOptions) => {
          sentEmails.push({
            to: emailOptions.to,
            template: emailOptions.template,
            skipLog: emailOptions.skipLog,
            idempotencyKey: emailOptions.idempotencyKey,
          });
          return `test-message-${sentEmails.length}`;
        },
      },
    };

    const result = await deleteAccountPermanently(options);
    assert.equal(result.deletedUserId, userId);
    assert.deepEqual(deletedFirebaseUids, [firebaseUid]);
    assert.equal(result.notifications.userConfirmationSent, true);
    assert.equal(result.notifications.adminNoticeSent, true);
    assert.equal(result.notifications.warnings.length, 0);
    assert.equal(sentEmails[0]?.to, email);
    assert.equal(sentEmails[0]?.skipLog, true);
    assert.equal(sentEmails[0]?.idempotencyKey, `account-deletion-user-${userId}`);
    assert.equal(sentEmails[1]?.to, "josh@marvelcardvault.com");
    assert.equal(sentEmails[1]?.idempotencyKey, `account-deletion-admin-${userId}`);
    assert.equal(await shouldSuppressAccountDeletionEmailEvent(email), true);
    await db
      .update(schema.accountDeletionEmailSuppressions)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(
        eq(
          schema.accountDeletionEmailSuppressions.recipientHash,
          accountDeletionRecipientHash(email),
        ),
      );
    assert.equal(
      await shouldSuppressAccountDeletionEmailEvent(email),
      true,
      "Hash-only suppression remains permanent even if a legacy expiry is in the past",
    );

    const [remainingUser, remainingEmailLogs, remainingEmailEvents, remainingFollows, remainingXp, remainingFeed, jobs] =
      await Promise.all([
        db.select().from(schema.users).where(eq(schema.users.id, userId)),
        db.select().from(schema.emailLogs).where(
          or(eq(schema.emailLogs.userId, userId), eq(schema.emailLogs.email, email)),
        ),
        db.select().from(schema.emailEvents).where(eq(schema.emailEvents.email, email)),
        db.select().from(schema.follows).where(
          or(
            eq(schema.follows.followerUserId, userId),
            eq(schema.follows.followingUserId, userId),
          ),
        ),
        db.select().from(schema.xpEvents).where(eq(schema.xpEvents.userId, userId)),
        db.select().from(schema.feedEvents).where(eq(schema.feedEvents.userId, userId)),
        db.select().from(schema.accountDeletionJobs).where(
          eq(schema.accountDeletionJobs.userId, userId),
        ),
      ]);

    assert.equal(remainingUser.length, 0);
    assert.equal(remainingEmailLogs.length, 0);
    assert.equal(remainingEmailEvents.length, 0);
    assert.equal(remainingFollows.length, 0);
    assert.equal(remainingXp.length, 0);
    assert.equal(remainingFeed.length, 0);
    assert.equal(jobs[0]?.status, "completed");
    assert.equal(jobs[0]?.email, null);
    assert.equal(jobs[0]?.firebaseUid, null);
  } finally {
    // If the service failed before completing, keep the test environment clean.
    await db.delete(schema.emailEvents).where(eq(schema.emailEvents.email, email)).catch(() => {});
    await db.delete(schema.emailLogs).where(eq(schema.emailLogs.email, email)).catch(() => {});
    await db.delete(schema.follows).where(
      or(
        eq(schema.follows.followerUserId, userId),
        eq(schema.follows.followingUserId, userId),
      ),
    ).catch(() => {});
    await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId)).catch(() => {});
    await db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.userId, userId)).catch(() => {});
    await db.delete(schema.userScanLogs).where(eq(schema.userScanLogs.userId, userId)).catch(() => {});
    await db.delete(schema.feedEvents).where(eq(schema.feedEvents.userId, userId)).catch(() => {});
    await db.delete(schema.xpEvents).where(eq(schema.xpEvents.userId, userId)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => {});
    await db.delete(schema.accountDeletionJobs).where(
      eq(schema.accountDeletionJobs.userId, userId),
    ).catch(() => {});
    await db.delete(schema.accountDeletionEmailSuppressions).where(
      eq(
        schema.accountDeletionEmailSuppressions.recipientHash,
        accountDeletionRecipientHash(email),
      ),
    ).catch(() => {});
  }
});

test("external deletion failures persist a truthful retry state", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `account-deletion-external-${suffix}@example.test`;
  const firebaseUid = `delete-external-firebase-${suffix}`;
  const [created] = await db
    .insert(schema.users)
    .values({
      firebaseUid,
      username: `delete_external_${suffix}`.slice(0, 40),
      email,
      stripeSubscriptionId: `sub_delete_${suffix}`,
    })
    .returning({ id: schema.users.id });
  assert.ok(created);

  const userId = created.id;
  let stripeCalls = 0;
  let firebaseCalls = 0;

  try {
    await assert.rejects(
      deleteAccountPermanently({
        userId,
        source: "self_service",
        dependencies: {
          cancelStripeSubscription: async () => {
            stripeCalls += 1;
          },
          deleteFirebaseUser: async () => {
            firebaseCalls += 1;
            throw new Error("temporary Firebase outage");
          },
          sendNotificationEmail: async () => "unused",
        },
      }),
      (error: unknown) =>
        error instanceof AccountDeletionPendingError && error.authDeleted === false,
    );

    assert.equal(stripeCalls, 1);
    assert.equal(firebaseCalls, 1);
    const [stillPresent] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    assert.ok(stillPresent, "Database data remains until Firebase deletion succeeds");

    const [pendingJob] = await db
      .select()
      .from(schema.accountDeletionJobs)
      .where(eq(schema.accountDeletionJobs.userId, userId));
    assert.equal(pendingJob?.status, "pending");
    assert.ok(pendingJob?.stripeCancelledAt);
    assert.equal(pendingJob?.firebaseDeletedAt, null);

    const result = await resumeAccountDeletion(userId, {
      cancelStripeSubscription: async () => {
        stripeCalls += 1;
      },
      deleteFirebaseUser: async () => {
        firebaseCalls += 1;
      },
      sendNotificationEmail: async () => "sent",
    });
    assert.equal(result.status, "completed");
    assert.equal(stripeCalls, 1, "A completed Stripe step is not repeated");
    assert.equal(firebaseCalls, 2);
    const users = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert.equal(users.length, 0);
  } finally {
    await db.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => {});
    await db.delete(schema.accountDeletionJobs).where(
      eq(schema.accountDeletionJobs.userId, userId),
    ).catch(() => {});
    await db.delete(schema.accountDeletionEmailSuppressions).where(
      eq(
        schema.accountDeletionEmailSuppressions.recipientHash,
        accountDeletionRecipientHash(email),
      ),
    ).catch(() => {});
  }
});

test("failed confirmation delivery retries after data deletion without duplicating admin notice", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `account-deletion-email-${suffix}@example.test`;
  const [created] = await db
    .insert(schema.users)
    .values({
      firebaseUid: `delete-email-firebase-${suffix}`,
      username: `delete_email_${suffix}`.slice(0, 40),
      email,
    })
    .returning({ id: schema.users.id });
  assert.ok(created);

  const userId = created.id;
  const firstAttemptTemplates: string[] = [];
  const retryTemplates: string[] = [];

  try {
    const initial = await deleteAccountPermanently({
      userId,
      source: "admin",
      actorEmail: "admin@example.test",
      dependencies: {
        cancelStripeSubscription: async () => {},
        deleteFirebaseUser: async () => {},
        sendNotificationEmail: async (options) => {
          firstAttemptTemplates.push(options.template || "");
          if (options.template === "account-deletion-user-confirmation") {
            throw new Error("temporary email outage");
          }
          return "admin-notice-sent";
        },
      },
    });

    assert.equal(initial.status, "notifications_pending");
    assert.equal(initial.notifications.userConfirmationSent, false);
    assert.equal(initial.notifications.adminNoticeSent, true);
    const users = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert.equal(users.length, 0, "Account data deletion is not undone by an email outage");

    const retried = await resumeAccountDeletion(userId, {
      cancelStripeSubscription: async () => {
        throw new Error("Completed Stripe stage must not repeat");
      },
      deleteFirebaseUser: async () => {
        throw new Error("Completed Firebase stage must not repeat");
      },
      sendNotificationEmail: async (options) => {
        retryTemplates.push(options.template || "");
        return "user-confirmation-sent";
      },
    });

    assert.equal(retried.status, "completed");
    assert.deepEqual(firstAttemptTemplates, [
      "account-deletion-user-confirmation",
      "account-deletion-admin-notice",
    ]);
    assert.deepEqual(retryTemplates, ["account-deletion-user-confirmation"]);

    const [completedJob] = await db
      .select()
      .from(schema.accountDeletionJobs)
      .where(eq(schema.accountDeletionJobs.userId, userId));
    assert.equal(completedJob?.status, "completed");
    assert.equal(completedJob?.email, null);
    assert.equal(await shouldSuppressAccountDeletionEmailEvent(email), true);
  } finally {
    await db.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => {});
    await db.delete(schema.accountDeletionJobs).where(
      eq(schema.accountDeletionJobs.userId, userId),
    ).catch(() => {});
    await db.delete(schema.accountDeletionEmailSuppressions).where(
      eq(
        schema.accountDeletionEmailSuppressions.recipientHash,
        accountDeletionRecipientHash(email),
      ),
    ).catch(() => {});
  }
});
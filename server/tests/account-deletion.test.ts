import assert from "node:assert/strict";
import test from "node:test";
import { eq, or } from "drizzle-orm";
import { db } from "../db";
import {
  AccountDeletionPendingError,
  accountDeletionRecipientHash,
  deleteAccountPermanently,
  resumeAccountDeletion,
  shouldSuppressAccountDeletionEmailEvent,
  type DeleteAccountOptions,
} from "../services/accountDeletion";
import * as schema from "../../shared/schema";

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
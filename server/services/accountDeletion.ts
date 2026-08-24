import admin from "firebase-admin";
import crypto from "crypto";
import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { invalidateUserById } from "../user-cache";
import * as schema from "../../shared/schema";
import { sendResendEmail, type ResendEmailOptions } from "./emailService";

const ACCOUNT_DELETION_ADMIN_EMAIL =
  process.env.ACCOUNT_DELETION_ADMIN_EMAIL?.trim() || "josh@marvelcardvault.com";

export class AccountNotFoundError extends Error {
  constructor() {
    super("User account not found");
    this.name = "AccountNotFoundError";
  }
}

export class AccountDeletionPendingError extends Error {
  readonly authDeleted: boolean;

  constructor(authDeleted: boolean) {
    super("Account deletion is pending and will retry automatically");
    this.name = "AccountDeletionPendingError";
    this.authDeleted = authDeleted;
  }
}

export type AccountDeletionSource = "self_service" | "admin";

type DeletedAccount = {
  id: number;
  firebaseUid: string;
  username: string;
  email: string;
  displayName: string | null;
  stripeSubscriptionId: string | null;
  appleOriginalTransactionId: string | null;
};

type NotificationResult = {
  userConfirmationSent: boolean;
  adminNoticeSent: boolean;
  warnings: string[];
};

export type AccountDeletionResult = {
  deletedUserId: number;
  status: "completed" | "notifications_pending";
  notifications: NotificationResult;
};

export type AccountDeletionDependencies = {
  deleteFirebaseUser?: (firebaseUid: string) => Promise<void>;
  cancelStripeSubscription?: (subscriptionId: string) => Promise<void>;
  sendNotificationEmail?: (options: ResendEmailOptions) => Promise<string | undefined>;
};

export type DeleteAccountOptions = {
  userId: number;
  source: AccountDeletionSource;
  actorUserId?: number;
  actorEmail?: string;
  dependencies?: AccountDeletionDependencies;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailShell(title: string, body: string): string {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
                <tr>
                  <td style="background:#111827;color:#ffffff;padding:24px 28px;">
                    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24;font-weight:700;">Marvelous Card Vault</div>
                    <h1 style="margin:8px 0 0;font-size:24px;line-height:1.3;">${title}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;font-size:15px;line-height:1.65;">${body}</td>
                </tr>
                <tr>
                  <td style="padding:18px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
                    This is a transactional account notice. No marketing preferences were used to send it.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}

function userConfirmationEmail(account: DeletedAccount): ResendEmailOptions {
  const greeting = account.displayName?.trim() || account.username;
  const appleNotice = account.appleOriginalTransactionId
    ? `<p style="margin:18px 0 0;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;color:#9a3412;"><strong>Apple subscription reminder:</strong> Deleting your vault does not cancel an App Store subscription. If it is still active, cancel it in your Apple subscription settings to prevent future renewals.</p>`
    : "";

  return {
    to: account.email,
    subject: "Your Marvelous Card Vault account has been deleted",
    html: emailShell(
      "Your account has been deleted",
      `<p style="margin:0 0 16px;">Hi ${escapeHtml(greeting)},</p>
       <p style="margin:0 0 16px;">Your Marvelous Card Vault account, profile, collection, wishlist, messages, social activity, scan history, and other account data have been permanently removed.</p>
       <p style="margin:0;">Your sign-in has also been removed. This action cannot be undone.</p>
       ${appleNotice}`,
    ),
    text: [
      `Hi ${greeting},`,
      "",
      "Your Marvelous Card Vault account and associated account data have been permanently deleted. Your sign-in has also been removed. This action cannot be undone.",
      ...(account.appleOriginalTransactionId
        ? [
            "",
            "Apple subscription reminder: deleting your vault does not cancel an App Store subscription. If it is still active, cancel it in your Apple subscription settings to prevent future renewals.",
          ]
        : []),
    ].join("\n"),
    template: "account-deletion-user-confirmation",
    jobName: `transactional-account-deletion-user-${account.id}`,
    idempotencyKey: `account-deletion-user-${account.id}`,
    // Logging this after deletion would recreate the departing user's email
    // address in email_logs. Resend remains the delivery record.
    skipLog: true,
  };
}

function adminNoticeEmail(params: {
  account: DeletedAccount;
  source: AccountDeletionSource;
  actorEmail?: string;
}): ResendEmailOptions {
  const { account, source, actorEmail } = params;
  const sourceLabel = source === "admin" ? "Admin Users" : "Self-service Account Settings";
  const actorRow =
    source === "admin"
      ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Deleted by</td><td style="padding:6px 0;">${escapeHtml(actorEmail || "Admin")}</td></tr>`
      : "";
  const appleRow = account.appleOriginalTransactionId
    ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Apple billing</td><td style="padding:6px 0;color:#9a3412;">User must cancel any active App Store subscription separately</td></tr>`
    : "";

  return {
    to: ACCOUNT_DELETION_ADMIN_EMAIL,
    subject: "Account deletion completed",
    html: emailShell(
      "Account deletion completed",
      `<p style="margin:0 0 18px;">An account and its associated application data were permanently deleted.</p>
       <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.45;">
         <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;">${escapeHtml(account.email)}</td></tr>
         <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Username</td><td style="padding:6px 0;">${escapeHtml(account.username)}</td></tr>
         <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Former user ID</td><td style="padding:6px 0;">${account.id}</td></tr>
         <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Source</td><td style="padding:6px 0;">${sourceLabel}</td></tr>
         ${actorRow}
         ${appleRow}
       </table>`,
    ),
    text: [
      "An account and its associated application data were permanently deleted.",
      `Email: ${account.email}`,
      `Username: ${account.username}`,
      `Former user ID: ${account.id}`,
      `Source: ${sourceLabel}`,
      ...(source === "admin" ? [`Deleted by: ${actorEmail || "Admin"}`] : []),
      ...(account.appleOriginalTransactionId
        ? ["Apple billing: user must cancel any active App Store subscription separately"]
        : []),
    ].join("\n"),
    template: "account-deletion-admin-notice",
    jobName: `transactional-account-deletion-admin-${account.id}`,
    idempotencyKey: `account-deletion-admin-${account.id}`,
  };
}

type AccountDeletionJob = typeof schema.accountDeletionJobs.$inferSelect;

let retryWorkerStarted = false;

export function accountDeletionRecipientHash(email: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for deletion-email suppression");
  return crypto
    .createHmac("sha256", secret)
    .update(`account-deletion:${email.trim().toLowerCase()}`)
    .digest("hex");
}

export async function ensureAccountDeletionInfrastructure(): Promise<void> {
  // Schema changes are applied to development by the workspace setup flow and
  // to production by Replit's Publish schema diff. Runtime DDL is intentionally
  // not used here.
}

async function suppressDeletionEmailEvents(email: string): Promise<void> {
  await ensureAccountDeletionInfrastructure();
  // Keep only a non-reversible HMAC permanently. Resend events can be delayed
  // or replayed long after account deletion, so time-limited suppression would
  // allow the deleted address to be written back into email_events later.
  const expiresAt = new Date("9999-12-31T23:59:59.999Z");
  await db
    .insert(schema.accountDeletionEmailSuppressions)
    .values({
      recipientHash: accountDeletionRecipientHash(email),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: schema.accountDeletionEmailSuppressions.recipientHash,
      set: { expiresAt },
    });
}

export async function shouldSuppressAccountDeletionEmailEvent(
  email: string | undefined,
): Promise<boolean> {
  if (!email?.trim()) return false;
  await ensureAccountDeletionInfrastructure();
  const [row] = await db
    .select({ recipientHash: schema.accountDeletionEmailSuppressions.recipientHash })
    .from(schema.accountDeletionEmailSuppressions)
    .where(
      eq(
        schema.accountDeletionEmailSuppressions.recipientHash,
        accountDeletionRecipientHash(email),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function defaultDeleteFirebaseUser(firebaseUid: string): Promise<void> {
  try {
    await admin.auth().deleteUser(firebaseUid);
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") return;
    throw error;
  }
}

function jobToDeletedAccount(job: AccountDeletionJob): DeletedAccount {
  if (!job.firebaseUid || !job.username || !job.email) {
    throw new Error("Deletion job identity payload is unavailable");
  }
  return {
    id: job.userId,
    firebaseUid: job.firebaseUid,
    username: job.username,
    email: job.email,
    displayName: job.displayName,
    stripeSubscriptionId: job.stripeSubscriptionId,
    appleOriginalTransactionId: job.appleOriginalTransactionId,
  };
}

async function stageDeletionJob(options: DeleteAccountOptions): Promise<AccountDeletionJob> {
  await ensureAccountDeletionInfrastructure();

  const [existing] = await db
    .select()
    .from(schema.accountDeletionJobs)
    .where(eq(schema.accountDeletionJobs.userId, options.userId))
    .limit(1);
  if (existing) return existing;

  const [account] = await db
    .select({
      id: schema.users.id,
      firebaseUid: schema.users.firebaseUid,
      username: schema.users.username,
      email: schema.users.email,
      displayName: schema.users.displayName,
      stripeSubscriptionId: schema.users.stripeSubscriptionId,
      appleOriginalTransactionId: schema.users.appleOriginalTransactionId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, options.userId))
    .limit(1);
  if (!account) throw new AccountNotFoundError();

  await db
    .insert(schema.accountDeletionJobs)
    .values({
      userId: account.id,
      firebaseUid: account.firebaseUid,
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      stripeSubscriptionId: account.stripeSubscriptionId,
      appleOriginalTransactionId: account.appleOriginalTransactionId,
      source: options.source,
      actorUserId: options.actorUserId,
      actorEmail: options.actorEmail,
      status: "pending",
    })
    .onConflictDoNothing({ target: schema.accountDeletionJobs.userId });

  const [job] = await db
    .select()
    .from(schema.accountDeletionJobs)
    .where(eq(schema.accountDeletionJobs.userId, options.userId))
    .limit(1);
  if (!job) throw new Error("Failed to stage account deletion");
  return job;
}

async function claimDeletionJob(userId: number): Promise<AccountDeletionJob> {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const [claimed] = await db
    .update(schema.accountDeletionJobs)
    .set({
      status: "processing",
      lastError: null,
      attemptCount: sql`${schema.accountDeletionJobs.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.accountDeletionJobs.userId, userId),
        ne(schema.accountDeletionJobs.status, "completed"),
        or(
          ne(schema.accountDeletionJobs.status, "processing"),
          lt(schema.accountDeletionJobs.updatedAt, staleBefore),
        ),
      ),
    )
    .returning();

  if (claimed) return claimed;

  const [job] = await db
    .select()
    .from(schema.accountDeletionJobs)
    .where(eq(schema.accountDeletionJobs.userId, userId))
    .limit(1);
  if (!job) throw new AccountNotFoundError();
  if (job.status === "completed") return job;
  throw new AccountDeletionPendingError(Boolean(job.firebaseDeletedAt));
}

async function updateDeletionJob(
  userId: number,
  values: Partial<typeof schema.accountDeletionJobs.$inferInsert>,
): Promise<AccountDeletionJob> {
  const [job] = await db
    .update(schema.accountDeletionJobs)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.accountDeletionJobs.userId, userId))
    .returning();
  if (!job) throw new Error("Account deletion job disappeared");
  return job;
}

async function finalizeAccountDataDeletion(job: AccountDeletionJob): Promise<AccountDeletionJob> {
  const userId = job.userId;
  let finalizedJob: AccountDeletionJob | undefined;

  await db.transaction(async (tx) => {
    const listingRows = await tx
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(eq(schema.listings.sellerId, userId));
    const listingIds = listingRows.map((row) => row.id);

    const orderRows = await tx
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(or(eq(schema.orders.buyerId, userId), eq(schema.orders.sellerId, userId)));
    const orderIds = orderRows.map((row) => row.id);

    const scanRows = await tx
      .select({ id: schema.scanUploads.id })
      .from(schema.scanUploads)
      .where(eq(schema.scanUploads.userId, userId));
    const scanIds = scanRows.map((row) => row.id);

    const feedRows = await tx
      .select({ id: schema.feedEvents.id })
      .from(schema.feedEvents)
      .where(eq(schema.feedEvents.userId, userId));
    const feedEventIds = feedRows.map((row) => row.id);

    const payoutBatchRows = await tx
      .select({ id: schema.payoutBatches.id })
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.adminId, userId));
    const payoutBatchIds = payoutBatchRows.map((row) => row.id);

    const account = jobToDeletedAccount(job);
    const normalizedEmail = account.email.trim().toLowerCase();
    const priorEmailRows = await tx
      .select({ providerMessageId: schema.emailLogs.providerMessageId })
      .from(schema.emailLogs)
      .where(
        or(
          eq(schema.emailLogs.userId, userId),
          sql`lower(trim(${schema.emailLogs.email})) = ${normalizedEmail}`,
        ),
      );
    const providerMessageIds = priorEmailRows
      .map((row) => row.providerMessageId)
      .filter((value): value is string => Boolean(value));

    // Remove dependent marketplace data before its orders/listings.
    if (orderIds.length > 0) {
      await tx.delete(schema.shipments).where(inArray(schema.shipments.orderId, orderIds));
      await tx.delete(schema.reviews).where(
        or(
          eq(schema.reviews.reviewerId, userId),
          eq(schema.reviews.revieweeId, userId),
          inArray(schema.reviews.orderId, orderIds),
        ),
      );
    } else {
      await tx.delete(schema.reviews).where(
        or(eq(schema.reviews.reviewerId, userId), eq(schema.reviews.revieweeId, userId)),
      );
    }

    const reportPredicates = [
      eq(schema.reports.reporterId, userId),
      eq(schema.reports.targetUserId, userId),
    ];
    if (orderIds.length > 0) reportPredicates.push(inArray(schema.reports.orderId, orderIds));
    if (listingIds.length > 0) {
      reportPredicates.push(inArray(schema.reports.listingId, listingIds));
    }
    await tx.delete(schema.reports).where(or(...reportPredicates));
    await tx
      .update(schema.reports)
      .set({ resolvedBy: null })
      .where(eq(schema.reports.resolvedBy, userId));

    const payoutItemPredicates = [eq(schema.payoutBatchItems.sellerId, userId)];
    if (orderIds.length > 0) {
      payoutItemPredicates.push(inArray(schema.payoutBatchItems.orderId, orderIds));
    }
    if (payoutBatchIds.length > 0) {
      payoutItemPredicates.push(inArray(schema.payoutBatchItems.payoutBatchId, payoutBatchIds));
    }
    await tx.delete(schema.payoutBatchItems).where(or(...payoutItemPredicates));
    if (payoutBatchIds.length > 0) {
      await tx.delete(schema.payoutBatches).where(inArray(schema.payoutBatches.id, payoutBatchIds));
    }

    if (orderIds.length > 0) {
      await tx.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
    }

    const offerPredicates = [eq(schema.offers.buyerId, userId)];
    if (listingIds.length > 0) offerPredicates.push(inArray(schema.offers.listingId, listingIds));
    await tx.delete(schema.offers).where(or(...offerPredicates));
    if (listingIds.length > 0) {
      await tx.delete(schema.listings).where(inArray(schema.listings.id, listingIds));
    }

    await tx
      .update(schema.payoutRequests)
      .set({ processedBy: null })
      .where(eq(schema.payoutRequests.processedBy, userId));
    await tx.delete(schema.payoutRequests).where(eq(schema.payoutRequests.sellerId, userId));
    await tx.delete(schema.payoutAccounts).where(eq(schema.payoutAccounts.userId, userId));

    // Remove social, collection, contribution, scan, and analytics data.
    await tx.delete(schema.follows).where(
      or(
        eq(schema.follows.followerUserId, userId),
        eq(schema.follows.followingUserId, userId),
      ),
    );
    await tx.delete(schema.friends).where(
      or(eq(schema.friends.requesterId, userId), eq(schema.friends.recipientId, userId)),
    );
    await tx.delete(schema.messages).where(
      or(eq(schema.messages.senderId, userId), eq(schema.messages.recipientId, userId)),
    );
    await tx.delete(schema.blocks).where(
      or(eq(schema.blocks.blockerId, userId), eq(schema.blocks.blockedUserId, userId)),
    );
    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
    await tx.delete(schema.shareLinks).where(eq(schema.shareLinks.userId, userId));
    await tx.delete(schema.upcomingSetInterests).where(
      eq(schema.upcomingSetInterests.userId, userId),
    );
    await tx.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.userId, userId));
    await tx.delete(schema.userScanLogs).where(eq(schema.userScanLogs.userId, userId));

    if (scanIds.length > 0) {
      await tx.delete(schema.scanFeedback).where(
        or(
          eq(schema.scanFeedback.userId, userId),
          inArray(schema.scanFeedback.scanUploadId, scanIds),
        ),
      );
    } else {
      await tx.delete(schema.scanFeedback).where(eq(schema.scanFeedback.userId, userId));
    }
    await tx.delete(schema.scanUploads).where(eq(schema.scanUploads.userId, userId));

    if (feedEventIds.length > 0) {
      await tx.delete(schema.feedReactions).where(
        or(
          eq(schema.feedReactions.userId, userId),
          inArray(schema.feedReactions.feedEventId, feedEventIds),
        ),
      );
    } else {
      await tx.delete(schema.feedReactions).where(eq(schema.feedReactions.userId, userId));
    }
    await tx.delete(schema.feedEvents).where(eq(schema.feedEvents.userId, userId));
    await tx.delete(schema.xpEvents).where(eq(schema.xpEvents.userId, userId));

    await tx.delete(schema.pendingCardImages).where(eq(schema.pendingCardImages.userId, userId));
    await tx
      .update(schema.pendingCardImages)
      .set({ reviewedBy: null })
      .where(eq(schema.pendingCardImages.reviewedBy, userId));

    await tx.delete(schema.pcBinders).where(eq(schema.pcBinders.userId, userId));
    await tx.delete(schema.userPlatforms).where(eq(schema.userPlatforms.userId, userId));
    await tx.delete(schema.userBadges).where(eq(schema.userBadges.userId, userId));
    await tx.delete(schema.userWishlists).where(eq(schema.userWishlists.userId, userId));
    await tx.delete(schema.userCollections).where(eq(schema.userCollections.userId, userId));

    // Preserve operational records without retaining a foreign-key link to a
    // deleted administrator.
    await tx
      .update(schema.migrationLogs)
      .set({ adminUserId: null })
      .where(eq(schema.migrationLogs.adminUserId, userId));
    await tx
      .update(schema.adminAuditLogs)
      .set({ adminUserId: null })
      .where(eq(schema.adminAuditLogs.adminUserId, userId));
    await tx.execute(sql`UPDATE push_logs SET sent_by_admin_id = NULL WHERE sent_by_admin_id = ${userId}`);
    await tx.execute(sql`DELETE FROM push_tokens WHERE user_id = ${userId}`);

    if (providerMessageIds.length > 0) {
      await tx.delete(schema.emailEvents).where(
        or(
          sql`lower(trim(${schema.emailEvents.email})) = ${normalizedEmail}`,
          inArray(schema.emailEvents.providerMessageId, providerMessageIds),
        ),
      );
    } else {
      await tx.delete(schema.emailEvents).where(
        sql`lower(trim(${schema.emailEvents.email})) = ${normalizedEmail}`,
      );
    }
    await tx.delete(schema.emailLogs).where(
      or(
        eq(schema.emailLogs.userId, userId),
        sql`lower(trim(${schema.emailLogs.email})) = ${normalizedEmail}`,
      ),
    );

    await tx.delete(schema.users).where(eq(schema.users.id, userId));

    await tx.insert(schema.adminAuditLogs).values({
      adminUserId:
        job.source === "admin" && job.actorUserId !== userId ? job.actorUserId || null : null,
      actionType: "delete_user_account",
      entityType: "user",
      entityId: userId,
      entityName: "Deleted account",
      notes: job.source === "admin" ? "Deleted from Admin Users" : "Self-service deletion",
    });

    const [updated] = await tx
      .update(schema.accountDeletionJobs)
      .set({
        status: "notifications_pending",
        dataDeletedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.accountDeletionJobs.userId, userId))
      .returning();
    finalizedJob = updated;
  });

  invalidateUserById(userId);
  if (!finalizedJob) throw new Error("Account deletion finalization did not persist");
  return finalizedJob;
}

async function deliverDeletionNotifications(
  initialJob: AccountDeletionJob,
  sendNotificationEmail: (options: ResendEmailOptions) => Promise<string | undefined>,
): Promise<{ job: AccountDeletionJob; notifications: NotificationResult }> {
  let job = initialJob;
  const account = jobToDeletedAccount(job);
  const warnings: string[] = [];

  if (!job.userConfirmationSentAt) {
    await suppressDeletionEmailEvents(account.email);
    try {
      await sendNotificationEmail(userConfirmationEmail(account));
      job = await updateDeletionJob(job.userId, {
        userConfirmationSentAt: new Date(),
      });
    } catch (error) {
      console.error("[AccountDeletion] User confirmation email failed:", error);
      warnings.push("The user confirmation email is pending automatic retry.");
    }
  }

  if (!job.adminNoticeSentAt) {
    try {
      await sendNotificationEmail(
        adminNoticeEmail({
          account,
          source: job.source as AccountDeletionSource,
          actorEmail: job.actorEmail || undefined,
        }),
      );
      job = await updateDeletionJob(job.userId, {
        adminNoticeSentAt: new Date(),
      });
    } catch (error) {
      console.error("[AccountDeletion] Admin notice email failed:", error);
      warnings.push("The admin deletion notice is pending automatic retry.");
    }
  }

  const userConfirmationSent = Boolean(job.userConfirmationSentAt);
  const adminNoticeSent = Boolean(job.adminNoticeSentAt);

  if (userConfirmationSent && adminNoticeSent) {
    job = await updateDeletionJob(job.userId, {
      status: "completed",
      firebaseUid: null,
      username: null,
      email: null,
      displayName: null,
      stripeSubscriptionId: null,
      appleOriginalTransactionId: null,
      actorEmail: null,
      lastError: null,
    });
  } else {
    job = await updateDeletionJob(job.userId, {
      status: "notifications_pending",
      lastError: warnings.join(" "),
    });
  }

  return {
    job,
    notifications: { userConfirmationSent, adminNoticeSent, warnings },
  };
}

async function runDeletionJob(
  userId: number,
  dependencies: AccountDeletionDependencies,
): Promise<AccountDeletionResult> {
  const deleteFirebaseUser = dependencies.deleteFirebaseUser || defaultDeleteFirebaseUser;
  const sendNotificationEmail = dependencies.sendNotificationEmail || sendResendEmail;
  let job = await claimDeletionJob(userId);

  if (job.status === "completed") {
    return {
      deletedUserId: userId,
      status: "completed",
      notifications: {
        userConfirmationSent: true,
        adminNoticeSent: true,
        warnings: [],
      },
    };
  }

  try {
    if (!job.stripeCancelledAt) {
      if (job.stripeSubscriptionId) {
        if (!dependencies.cancelStripeSubscription) {
          throw new Error("Stripe cancellation handler is unavailable");
        }
        await dependencies.cancelStripeSubscription(job.stripeSubscriptionId);
      }
      job = await updateDeletionJob(userId, { stripeCancelledAt: new Date() });
    }

    if (!job.firebaseDeletedAt) {
      if (!job.firebaseUid) throw new Error("Firebase identity is unavailable");
      await deleteFirebaseUser(job.firebaseUid);
      job = await updateDeletionJob(userId, { firebaseDeletedAt: new Date() });
    }

    if (!job.dataDeletedAt) {
      job = await finalizeAccountDataDeletion(job);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown deletion error";
    await updateDeletionJob(userId, {
      status: "pending",
      lastError: message,
    }).catch((updateError) => {
      console.error("[AccountDeletion] Failed to persist pending state:", updateError);
    });
    console.error(`[AccountDeletion] Job ${userId} is pending:`, error);
    throw new AccountDeletionPendingError(Boolean(job.firebaseDeletedAt));
  }

  const delivered = await deliverDeletionNotifications(job, sendNotificationEmail);

  return {
    deletedUserId: userId,
    status: delivered.job.status === "completed" ? "completed" : "notifications_pending",
    notifications: delivered.notifications,
  };
}

export async function deleteAccountPermanently(
  options: DeleteAccountOptions,
): Promise<AccountDeletionResult> {
  const job = await stageDeletionJob(options);
  return runDeletionJob(job.userId, options.dependencies || {});
}

export async function resumeAccountDeletion(
  userId: number,
  dependencies: AccountDeletionDependencies,
): Promise<AccountDeletionResult> {
  await ensureAccountDeletionInfrastructure();
  return runDeletionJob(userId, dependencies);
}

export async function resumePendingAccountDeletions(
  dependencies: AccountDeletionDependencies,
): Promise<void> {
  await ensureAccountDeletionInfrastructure();
  const jobs = await db
    .select({ userId: schema.accountDeletionJobs.userId })
    .from(schema.accountDeletionJobs)
    .where(ne(schema.accountDeletionJobs.status, "completed"))
    .limit(20);

  for (const job of jobs) {
    try {
      await runDeletionJob(job.userId, dependencies);
    } catch (error) {
      if (!(error instanceof AccountDeletionPendingError)) {
        console.error(`[AccountDeletion] Retry failed for job ${job.userId}:`, error);
      }
    }
  }
}

export function startAccountDeletionRetryWorker(
  dependencies: AccountDeletionDependencies,
): void {
  if (retryWorkerStarted) return;
  retryWorkerStarted = true;

  const run = () => {
    resumePendingAccountDeletions(dependencies).catch((error) => {
      console.error("[AccountDeletion] Retry worker failed:", error);
    });
  };

  setTimeout(run, 5_000).unref();
  setInterval(run, 15 * 60 * 1000).unref();
}
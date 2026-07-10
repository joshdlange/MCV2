/**
 * Email Cron Jobs for Marvel Card Vault
 * Automated email sending based on scheduled triggers
 */

import cron from 'cron';
import { db } from '../db';
import { users, userCollections, cardSets } from '../../shared/schema';
import { sql, lt, eq, and, ne } from 'drizzle-orm';
import * as emailTriggers from '../services/emailTriggers';
import { sendResendEmail } from '../services/emailService';
import { vaultUpgradeAnnouncementTemplate } from '../services/emailTemplates';

const { CronJob } = cron;

/**
 * Monthly nudges job: Send emails to inactive users and onboarding nudges
 * Runs on the 1st of every month at 9:00 AM
 */
export const monthlyNudgesJob = new CronJob(
  '0 9 1 * *', // 9:00 AM on the 1st of every month
  async () => {
    console.log('🕒 Running monthly nudges job...');
    
    try {
      // Find users inactive for 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      // Only send if they haven't received this email in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const inactiveUsers = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          lastLogin: users.lastLogin,
          lastInactivityEmailSent: users.lastInactivityEmailSent,
        })
        .from(users)
        .where(
          and(
            lt(users.lastLogin, sevenDaysAgo),
            eq(users.emailUpdates, true), // Only send to users who opted in
            sql`(${users.lastInactivityEmailSent} IS NULL OR ${users.lastInactivityEmailSent} < ${thirtyDaysAgo})`
          )
        )
        .limit(50); // Batch limit to avoid overwhelming the email service
      
      console.log(`📧 Sending inactivity reminders to ${inactiveUsers.length} users (max 1 per month)`);
      
      for (const user of inactiveUsers) {
        await emailTriggers.onInactivityReminder({
          email: user.email,
          displayName: user.displayName || 'Collector',
        });
        
        // Update timestamp to prevent sending again within 30 days
        await db
          .update(users)
          .set({ lastInactivityEmailSent: new Date() })
          .where(eq(users.id, user.id));
      }
      
      // Find new users who haven't added any cards in 72 hours
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      
      const newUsersQuery = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(
          and(
            lt(users.createdAt, threeDaysAgo),
            eq(users.emailUpdates, true)
          )
        )
        .limit(50);
      
      // Check which of these users have no cards
      const usersWithoutCards = [];
      for (const user of newUsersQuery) {
        const userCards = await db
          .select({ count: sql<number>`count(*)` })
          .from(userCollections)
          .where(eq(userCollections.userId, user.id));
        
        if (Number(userCards[0]?.count) === 0) {
          usersWithoutCards.push(user);
        }
      }
      
      console.log(`📧 Sending "add first card" nudges to ${usersWithoutCards.length} users`);
      
      for (const user of usersWithoutCards) {
        await emailTriggers.onAddFirstCardNudge({
          email: user.email,
          displayName: user.displayName || 'Collector',
        });
      }
      
      console.log('✅ Monthly nudges job completed');
    } catch (error) {
      console.error('❌ Error in monthly nudges job:', error);
    }
  },
  null, // onComplete callback
  false, // start immediately
  'America/New_York' // timezone
);

/**
 * Monthly digest job: Send digest emails
 * Runs on the 1st of every month at 9:00 AM
 */
export const monthlyDigestJob = new CronJob(
  '0 9 1 * *', // 9:00 AM on the 1st of every month
  async () => {
    console.log('🕒 Running monthly digest job...');
    
    try {
      // Only send if they haven't received this email in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Get users who opted into marketing emails
      const subscribedUsers = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          lastWeeklyDigestSent: users.lastWeeklyDigestSent,
        })
        .from(users)
        .where(
          and(
            eq(users.marketingOptIn, true),
            sql`(${users.lastWeeklyDigestSent} IS NULL OR ${users.lastWeeklyDigestSent} < ${thirtyDaysAgo})`
          )
        )
        .limit(200); // Batch limit
      
      // Get card sets added in the last 7 days
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      const newSets = await db
        .select({
          name: cardSets.name,
          cardCount: sql<number>`COALESCE(${cardSets.cardCount}, 0)`,
        })
        .from(cardSets)
        .where(
          cardSets.createdAt ? lt(cardSets.createdAt, new Date()) : sql`true`
        )
        .limit(10);
      
      const setsData = newSets.map(set => ({
        name: set.name,
        cardCount: Number(set.cardCount || 0)
      }));
      
      console.log(`📧 Sending monthly digest to ${subscribedUsers.length} users with ${setsData.length} new sets (max 1 per month)`);
      
      for (const user of subscribedUsers) {
        await emailTriggers.onWeeklyDigest(
          {
            email: user.email,
            displayName: user.displayName || 'Collector',
          },
          setsData
        );
        
        // Update timestamp to prevent sending again within 30 days
        await db
          .update(users)
          .set({ lastWeeklyDigestSent: new Date() })
          .where(eq(users.id, user.id));
      }
      
      console.log('✅ Monthly digest job completed');
    } catch (error) {
      console.error('❌ Error in monthly digest job:', error);
    }
  },
  null,
  false,
  'America/New_York'
);

/**
 * Google Play Store Launch Email Campaign
 * One-time job: January 10, 2026 at 10:00 AM Central Time
 * Sends to ALL users announcing the Android app launch with promo code WNFREE3
 */
export const googlePlayLaunchJob = new CronJob(
  '0 10 10 1 *', // 10:00 AM on January 10
  async () => {
    console.log('🚀 Running Google Play Store launch email campaign...');
    
    try {
      // Get ALL users (this is a major announcement)
      const allUsers = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.emailUpdates, true)); // Only users who opted in to emails
      
      console.log(`📧 Sending Google Play launch announcement to ${allUsers.length} users`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const user of allUsers) {
        try {
          await emailTriggers.onGooglePlayLaunch({
            email: user.email,
            displayName: user.displayName || 'Collector',
          });
          successCount++;
          
          // Small delay to avoid overwhelming the email service
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Failed to send to ${user.email}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Google Play launch campaign completed: ${successCount} sent, ${errorCount} failed`);
      
      // Stop the job after it runs once (one-time campaign)
      googlePlayLaunchJob.stop();
      console.log('🛑 Google Play launch job stopped (one-time campaign complete)');
    } catch (error) {
      console.error('❌ Error in Google Play launch campaign:', error);
    }
  },
  null,
  false,
  'America/Chicago' // Central Time
);

/**
 * THANKS2U Coupon Blast
 * One-time job: June 10, 2026 at 9:00 AM Central Time
 * Sends to all non-upgraded (SIDE_KICK) users with a 2-month free coupon code
 */
export const thanks2uBlastJob = new CronJob(
  '0 9 10 6 *', // 9:00 AM on June 10
  async () => {
    console.log('🎉 Running THANKS2U coupon blast email campaign...');

    try {
      const nonUpgradedUsers = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(
          and(
            ne(users.plan, 'SUPER_HERO'),
            eq(users.emailUpdates, true)
          )
        );

      console.log(`📧 Sending THANKS2U coupon to ${nonUpgradedUsers.length} non-upgraded users`);

      let successCount = 0;
      let errorCount = 0;

      for (const user of nonUpgradedUsers) {
        try {
          await emailTriggers.onThanks2uCoupon({
            email: user.email,
            displayName: user.displayName || 'Collector',
          });
          successCount++;
          // Small delay to avoid overwhelming the email service
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          console.error(`Failed to send THANKS2U to ${user.email}:`, error);
          errorCount++;
        }
      }

      console.log(`✅ THANKS2U blast completed: ${successCount} sent, ${errorCount} failed`);

      // Stop after running once (one-time campaign)
      thanks2uBlastJob.stop();
      console.log('🛑 THANKS2U blast job stopped (one-time campaign complete)');
    } catch (error) {
      console.error('❌ Error in THANKS2U blast campaign:', error);
    }
  },
  null,
  false,
  'America/Chicago' // Central Time
);

// Track manual send state
let thanks2uManualSentAt: Date | null = null;

/**
 * Run the THANKS2U blast immediately (admin-triggered manual send)
 */
export async function runThanks2uBlastNow(): Promise<{ sent: number; failed: number }> {
  const nonUpgradedUsers = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(ne(users.plan, 'SUPER_HERO'), eq(users.emailUpdates, true)));

  let successCount = 0;
  let errorCount = 0;

  for (const user of nonUpgradedUsers) {
    try {
      await emailTriggers.onThanks2uCoupon({
        email: user.email,
        displayName: user.displayName || 'Collector',
      });
      successCount++;
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (error) {
      console.error(`Failed to send THANKS2U to ${user.email}:`, error);
      errorCount++;
    }
  }

  thanks2uManualSentAt = new Date();
  thanks2uBlastJob.stop(); // cancel the scheduled send too
  return { sent: successCount, failed: errorCount };
}

/**
 * THANKS2U Follow-Up Blast
 * One-time job: June 24, 2026 at 9:00 AM Central Time
 * Sends to all non-upgraded users who have NOT yet received the original blast
 * (catches the 43 missed from June 10 + any new signups between then and now)
 */
export const thanks2uFollowUpJob = new CronJob(
  '0 9 24 6 *', // 9:00 AM on June 24
  async () => {
    console.log('🎉 Running THANKS2U follow-up email campaign...');

    try {
      const notYetReceived = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(
          and(
            ne(users.plan, 'SUPER_HERO'),
            eq(users.emailUpdates, true),
            sql`${users.email} NOT IN (SELECT email FROM email_logs WHERE template = 'thanks2u-coupon')`
          )
        );

      console.log(`📧 Sending THANKS2U follow-up to ${notYetReceived.length} users who haven't received it yet`);

      let successCount = 0;
      let errorCount = 0;

      for (const user of notYetReceived) {
        try {
          await emailTriggers.onThanks2uCoupon({
            email: user.email,
            displayName: user.displayName || 'Collector',
          });
          successCount++;
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          console.error(`Failed to send THANKS2U follow-up to ${user.email}:`, error);
          errorCount++;
        }
      }

      console.log(`✅ THANKS2U follow-up completed: ${successCount} sent, ${errorCount} failed`);
      thanks2uFollowUpJob.stop();
      console.log('🛑 THANKS2U follow-up job stopped (one-time campaign complete)');
    } catch (error) {
      console.error('❌ Error in THANKS2U follow-up campaign:', error);
    }
  },
  null,
  false,
  'America/Chicago'
);

let thanks2uFollowUpManualSentAt: Date | null = null;

export async function runThanks2uFollowUpNow(): Promise<{ sent: number; failed: number }> {
  const notYetReceived = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(
      and(
        ne(users.plan, 'SUPER_HERO'),
        eq(users.emailUpdates, true),
        sql`${users.email} NOT IN (SELECT email FROM email_logs WHERE template = 'thanks2u-coupon')`
      )
    );

  let successCount = 0;
  let errorCount = 0;

  for (const user of notYetReceived) {
    try {
      await emailTriggers.onThanks2uCoupon({
        email: user.email,
        displayName: user.displayName || 'Collector',
      });
      successCount++;
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (error) {
      console.error(`Failed to send THANKS2U follow-up to ${user.email}:`, error);
      errorCount++;
    }
  }

  thanks2uFollowUpManualSentAt = new Date();
  thanks2uFollowUpJob.stop();
  return { sent: successCount, failed: errorCount };
}

export function getThanks2uStatus() {
  return {
    scheduled: '2026-06-10T09:00:00-05:00',
    jobRunning: thanks2uBlastJob.running || false,
    manualSentAt: thanks2uManualSentAt,
    followUp: {
      scheduled: '2026-06-24T09:00:00-05:00',
      jobRunning: thanks2uFollowUpJob.running || false,
      manualSentAt: thanks2uFollowUpManualSentAt,
    },
  };
}

/**
 * Vault Upgrade Announcement Campaign
 * One-time job: July 10, 2026 at 12:00 PM Central Time
 * Sends to all users with marketingOptIn=true
 */
let vaultUpgradeManualSentAt: Date | null = null;

export const vaultUpgradeJob = new CronJob(
  '0 12 10 7 *', // 12:00 PM on July 10
  async () => {
    console.log('📧 Running Vault Upgrade announcement campaign...');
    try {
      const { sent, failed } = await runVaultUpgradeNow();
      console.log(`✅ Vault Upgrade campaign complete: ${sent} sent, ${failed} failed`);
      vaultUpgradeJob.stop();
      console.log('🛑 Vault Upgrade job stopped (one-time campaign complete)');
    } catch (error) {
      console.error('❌ Error in Vault Upgrade campaign:', error);
    }
  },
  null,
  false,
  'America/Chicago' // Central Time
);

export async function runVaultUpgradeNow(): Promise<{ sent: number; failed: number }> {
  const eligibleUsers = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.marketingOptIn, true), ne(users.email, '')));

  const { html, text } = vaultUpgradeAnnouncementTemplate();
  const subject = 'Your Vault Just Got Bigger';

  let sent = 0;
  let failed = 0;

  console.log(`[VaultUpgrade] Sending to ${eligibleUsers.length} opted-in users`);

  for (const user of eligibleUsers) {
    if (!user.email) { failed++; continue; }
    try {
      await sendResendEmail({
        to: user.email,
        subject,
        html,
        text,
        template: 'vault-upgrade-announcement',
        jobName: 'campaign-vault-upgrade-send',
      });
      sent++;
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      failed++;
      console.error(`[VaultUpgrade] Failed to send to ${user.email}:`, err);
    }
  }

  vaultUpgradeManualSentAt = new Date();
  vaultUpgradeJob.stop();
  return { sent, failed };
}

export function getVaultUpgradeStatus() {
  return {
    scheduled: '2026-07-10T12:00:00-05:00',
    jobRunning: vaultUpgradeJob.running || false,
    manualSentAt: vaultUpgradeManualSentAt,
  };
}

/**
 * Initialize and start all cron jobs
 * Can be disabled via EMAIL_CRON_ENABLED environment variable
 */
export function startEmailCronJobs() {
  if (process.env.EMAIL_CRON_ENABLED !== 'true') {
    console.log('📅 Email cron jobs are DISABLED (set EMAIL_CRON_ENABLED=true to enable)');
    return;
  }
  
  console.log('📅 Starting email cron jobs...');
  monthlyNudgesJob.start();
  monthlyDigestJob.start();
  googlePlayLaunchJob.start();
  thanks2uBlastJob.start();
  thanks2uFollowUpJob.start();
  vaultUpgradeJob.start();
  console.log('✅ Email cron jobs started:');
  console.log('  - Monthly nudges: 9:00 AM on the 1st of each month');
  console.log('  - Monthly digest: 9:00 AM on the 1st of each month');
  console.log('  - Google Play Launch: 10:00 AM Central on Jan 10, 2026 (one-time)');
  console.log('  - THANKS2U Coupon Blast: 9:00 AM Central on Jun 10, 2026 (one-time)');
  console.log('  - THANKS2U Follow-Up: 9:00 AM Central on Jun 24, 2026 (one-time)');
  console.log('  - Vault Upgrade Announcement: 12:00 PM Central on Jul 10, 2026 (one-time)');
}

/**
 * Stop all cron jobs (useful for testing or shutdown)
 */
export function stopEmailCronJobs() {
  console.log('⏹️  Stopping email cron jobs...');
  monthlyNudgesJob.stop();
  monthlyDigestJob.stop();
  googlePlayLaunchJob.stop();
  thanks2uBlastJob.stop();
  thanks2uFollowUpJob.stop();
  vaultUpgradeJob.stop();
}

/**
 * Get status of all cron jobs
 */
export function getEmailCronStatus() {
  return {
    enabled: process.env.EMAIL_CRON_ENABLED === 'true',
    jobs: [
      {
        name: 'monthlyNudgesJob',
        schedule: '0 9 1 * *',
        running: monthlyNudgesJob.running || false,
        description: 'Sends inactivity reminders and onboarding nudges monthly'
      },
      {
        name: 'monthlyDigestJob',
        schedule: '0 9 1 * *',
        running: monthlyDigestJob.running || false,
        description: 'Sends monthly digest of new sets and activity'
      },
      {
        name: 'googlePlayLaunchJob',
        schedule: '0 10 10 1 *',
        running: googlePlayLaunchJob.running || false,
        description: 'Google Play launch announcement - Jan 10, 2026 10 AM Central (one-time)'
      },
      {
        name: 'thanks2uBlastJob',
        schedule: '0 9 10 6 *',
        running: thanks2uBlastJob.running || false,
        description: 'THANKS2U coupon blast to non-upgraded users - Jun 10, 2026 9 AM Central (one-time)'
      },
      {
        name: 'thanks2uFollowUpJob',
        schedule: '0 9 24 6 *',
        running: thanks2uFollowUpJob.running || false,
        description: 'THANKS2U follow-up to users who missed the June 10 blast - Jun 24, 2026 9 AM Central (one-time)'
      },
      {
        name: 'vaultUpgradeJob',
        schedule: '0 12 10 7 *',
        running: vaultUpgradeJob.running || false,
        description: 'Vault Upgrade announcement (500-card limit + PC Binders) - Jul 10, 2026 12 PM Central (one-time)'
      }
    ]
  };
}

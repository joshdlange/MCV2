/**
 * Email Cron Jobs for Marvel Card Vault
 * Automated email sending based on scheduled triggers
 */

import cron from 'cron';
import { db } from '../db';
import { users, userCollections, cardSets } from '../../shared/schema';
import { sql, lt, eq, and } from 'drizzle-orm';
import * as emailTriggers from '../services/emailTriggers';

const { CronJob } = cron;

/**
 * Monthly job: Send emails to inactive users and onboarding nudges
 * Runs on the 1st of every month at 9:00 AM
 */
export const dailyEmailJob = new CronJob(
  '0 9 1 * *', // 9:00 AM on the 1st of every month
  async () => {
    console.log('🕒 Running daily email job...');
    
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
      
      console.log('✅ Daily email job completed');
    } catch (error) {
      console.error('❌ Error in daily email job:', error);
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
export const weeklyDigestJob = new CronJob(
  '0 9 1 * *', // 9:00 AM on the 1st of every month
  async () => {
    console.log('🕒 Running weekly digest job...');
    
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
      
      console.log(`📧 Sending weekly digest to ${subscribedUsers.length} users with ${setsData.length} new sets (max 1 per month)`);
      
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
      
      console.log('✅ Weekly digest job completed');
    } catch (error) {
      console.error('❌ Error in weekly digest job:', error);
    }
  },
  null,
  false,
  'America/New_York'
);

/**
 * Initialize and start all cron jobs
 */
export function startEmailCronJobs() {
  console.log('📅 Starting email cron jobs...');
  dailyEmailJob.start();
  weeklyDigestJob.start();
  console.log('✅ Email cron jobs started:');
  console.log('  - Monthly emails: 9:00 AM on the 1st of each month');
  console.log('  - Monthly digest: 9:00 AM on the 1st of each month');
}

/**
 * Stop all cron jobs (useful for testing or shutdown)
 */
export function stopEmailCronJobs() {
  console.log('⏹️  Stopping email cron jobs...');
  dailyEmailJob.stop();
  weeklyDigestJob.stop();
}

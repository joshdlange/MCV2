/**
 * Email Trigger Functions for Marvel Card Vault
 * Handles all automated email sending based on user actions
 */

import { sendEmail } from './emailService';
import * as templates from './emailTemplates';

interface User {
  email: string;
  displayName: string;
  username?: string;
}

interface BadgeInfo {
  name: string;
  description: string;
  icon?: string;
}

interface Trade {
  id: number;
  offeredCards?: string[];
  requestedCards?: string[];
  partnerUsername?: string;
}

interface Card {
  name: string;
  imageUrl?: string;
  reason?: string;
}

interface SetInfo {
  name: string;
  releaseDate: string;
  imageUrl?: string;
}

interface Milestone {
  count: number;
  type: string;
}

interface NewSet {
  name: string;
  cardCount: number;
}

/**
 * Trigger: User completes signup/onboarding
 */
export async function onUserSignup(user: User): Promise<void> {
  try {
    const html = templates.welcomeTemplate({
      displayName: user.displayName,
      username: user.username || 'collector'
    });
    await sendEmail(user.email, 'Welcome to Marvel Card Vault', html, 'welcome');
  } catch (error) {
    console.error('Failed to send welcome email:', error);
  }
}

/**
 * Trigger: User requests password reset
 */
export async function onPasswordReset(user: User, resetLink: string): Promise<void> {
  try {
    const html = templates.passwordResetTemplate({ email: user.email }, resetLink);
    await sendEmail(user.email, 'Reset Your Password', html, 'password-reset');
  } catch (error) {
    console.error('Failed to send password reset email:', error);
  }
}

/**
 * Trigger: Password successfully reset
 */
export async function onPasswordResetConfirm(user: User): Promise<void> {
  try {
    const html = templates.passwordResetConfirmationTemplate({ displayName: user.displayName });
    await sendEmail(user.email, 'Password Changed Successfully', html, 'password-reset-confirmation');
  } catch (error) {
    console.error('Failed to send password reset confirmation email:', error);
  }
}

/**
 * Trigger: User unlocks a badge/achievement
 */
export async function onBadgeUnlocked(user: User, badgeInfo: BadgeInfo): Promise<void> {
  try {
    const html = templates.badgeUnlockedTemplate(
      { displayName: user.displayName },
      badgeInfo
    );
    await sendEmail(user.email, `Achievement Unlocked: ${badgeInfo.name}`, html, 'badge-unlocked');
  } catch (error) {
    console.error('Failed to send badge unlocked email:', error);
  }
}

/**
 * Trigger: User receives a new trade proposal
 */
export async function onTradeProposed(
  sender: User,
  receiver: User,
  trade: Trade
): Promise<void> {
  try {
    const html = templates.tradeProposedTemplate(
      { displayName: sender.displayName, username: sender.username || 'collector' },
      { displayName: receiver.displayName },
      {
        id: trade.id,
        offeredCards: trade.offeredCards || [],
        requestedCards: trade.requestedCards || []
      }
    );
    await sendEmail(receiver.email, 'New Trade Proposal from ' + sender.displayName, html, 'trade-proposed');
  } catch (error) {
    console.error('Failed to send trade proposed email:', error);
  }
}

/**
 * Trigger: Trade is accepted
 */
export async function onTradeAccepted(user: User, trade: Trade): Promise<void> {
  try {
    const html = templates.tradeAcceptedTemplate(
      { displayName: user.displayName },
      { id: trade.id, partnerUsername: trade.partnerUsername || 'collector' }
    );
    await sendEmail(user.email, 'Trade Accepted', html, 'trade-accepted');
  } catch (error) {
    console.error('Failed to send trade accepted email:', error);
  }
}

/**
 * Trigger: Trade is declined
 */
export async function onTradeDeclined(user: User, trade: Trade): Promise<void> {
  try {
    const html = templates.tradeDeclinedTemplate(
      { displayName: user.displayName },
      { id: trade.id, partnerUsername: trade.partnerUsername || 'collector' }
    );
    await sendEmail(user.email, 'Trade Update', html, 'trade-declined');
  } catch (error) {
    console.error('Failed to send trade declined email:', error);
  }
}

/**
 * Trigger: User's card image submission is approved
 */
export async function onCardImageApproved(user: User, card: Card): Promise<void> {
  try {
    const html = templates.cardImageApprovedTemplate(
      { displayName: user.displayName },
      card
    );
    await sendEmail(user.email, 'Image Approved', html, 'card-image-approved');
  } catch (error) {
    console.error('Failed to send card image approved email:', error);
  }
}

/**
 * Trigger: User's card image submission is rejected
 */
export async function onCardImageRejected(user: User, card: Card): Promise<void> {
  try {
    const html = templates.cardImageRejectedTemplate(
      { displayName: user.displayName },
      card
    );
    await sendEmail(user.email, 'Card Image Update', html, 'card-image-rejected');
  } catch (error) {
    console.error('Failed to send card image rejected email:', error);
  }
}

/**
 * Trigger: Admin sends notification about new upcoming set
 */
export async function onNewSetAnnouncement(user: User, setInfo: SetInfo): Promise<void> {
  try {
    const html = templates.newSetNotificationTemplate(
      { displayName: user.displayName },
      setInfo
    );
    await sendEmail(user.email, `New Set: ${setInfo.name}`, html, 'new-set-notification');
  } catch (error) {
    console.error('Failed to send new set announcement email:', error);
  }
}

/**
 * Trigger: Nudge user to add their first card
 */
export async function onAddFirstCardNudge(user: User): Promise<void> {
  try {
    const html = templates.addFirstCardTemplate({ displayName: user.displayName });
    await sendEmail(user.email, 'Track Your First Card', html, 'add-first-card');
  } catch (error) {
    console.error('Failed to send add first card nudge email:', error);
  }
}

/**
 * Trigger: Nudge user to complete profile setup
 */
export async function onFinishSetupNudge(user: User): Promise<void> {
  try {
    const html = templates.finishSetupTemplate({ displayName: user.displayName });
    await sendEmail(user.email, 'Finish Your Profile', html, 'finish-setup');
  } catch (error) {
    console.error('Failed to send finish setup nudge email:', error);
  }
}

/**
 * Trigger: User has been inactive for 7 days
 */
export async function onInactivityReminder(user: User): Promise<void> {
  try {
    const html = templates.inactiveUserTemplate({ displayName: user.displayName });
    await sendEmail(user.email, "What's New at Marvel Card Vault", html, 'inactive-user');
  } catch (error) {
    console.error('Failed to send inactivity reminder email:', error);
  }
}

/**
 * Trigger: User hits a collection milestone
 */
export async function onCollectionMilestone(user: User, milestone: Milestone): Promise<void> {
  try {
    const html = templates.collectionMilestoneTemplate(
      { displayName: user.displayName },
      milestone
    );
    await sendEmail(user.email, 'Collection Milestone', html, 'collection-milestone');
  } catch (error) {
    console.error('Failed to send collection milestone email:', error);
  }
}

/**
 * Trigger: Weekly digest of new sets and activity
 */
export async function onWeeklyDigest(user: User, sets: NewSet[]): Promise<void> {
  try {
    const html = templates.weeklyDigestTemplate(
      { displayName: user.displayName },
      sets
    );
    await sendEmail(user.email, 'Monthly Update - Marvel Card Vault', html, 'weekly-digest');
  } catch (error) {
    console.error('Failed to send weekly digest email:', error);
  }
}

/**
 * Trigger: Google Play Store Launch Announcement
 */
export async function onGooglePlayLaunch(user: User): Promise<void> {
  try {
    const html = templates.googlePlayLaunchTemplate({ displayName: user.displayName });
    await sendEmail(user.email, 'MCV now available on Google Play', html, 'google-play-launch');
  } catch (error) {
    console.error('Failed to send Google Play launch email:', error);
  }
}

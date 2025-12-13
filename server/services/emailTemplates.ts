/**
 * Email Template Engine for Marvel Card Vault
 * All templates use a consistent dark theme with Marvel red accents
 */

const LOGO_URL = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1765655501/marvel-card-vault/email-logo.png';
const BRAND_RED = '#EF4444';
const DARK_BG = '#0F172A';
const CARD_BG = '#1E293B';
const TEXT_PRIMARY = '#F1F5F9';
const TEXT_SECONDARY = '#94A3B8';

/**
 * Base template wrapper providing consistent layout and styling
 */
function baseTemplate({ title, bodyHtml }: { title: string; bodyHtml: string }): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ${DARK_BG}; color: ${TEXT_PRIMARY};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${DARK_BG};">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: ${CARD_BG}; border-radius: 12px; overflow: hidden;">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, ${DARK_BG} 0%, ${CARD_BG} 100%);">
              <img src="${LOGO_URL}" alt="Marvel Card Vault" style="width: 150px; height: auto; display: block; margin: 0 auto;">
            </td>
          </tr>
          
          <!-- Body Content -->
          <tr>
            <td style="padding: 20px 40px 40px;">
              ${bodyHtml}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: ${DARK_BG}; border-top: 1px solid #334155; text-align: center;">
              <p style="margin: 0 0 10px; font-size: 14px; color: ${TEXT_SECONDARY};">
                <strong style="color: ${BRAND_RED};">Marvel Card Vault</strong><br>
                Your Ultimate Marvel Trading Card Collection Manager
              </p>
              <p style="margin: 0; font-size: 12px; color: ${TEXT_SECONDARY};">
                <a href="https://marvelcardvault.com" style="color: ${BRAND_RED}; text-decoration: none;">Visit Website</a> |
                <a href="https://marvelcardvault.com/settings" style="color: ${BRAND_RED}; text-decoration: none;">Email Preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Button component for CTAs
 */
function ctaButton(text: string, url: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="text-align: center; padding: 20px 0;">
          <a href="${url}" style="display: inline-block; padding: 16px 32px; background-color: ${BRAND_RED}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

// =============================================================================
// TRANSACTIONAL TEMPLATES
// =============================================================================

/**
 * 1. Welcome / Onboarding Complete
 */
export function welcomeTemplate(user: { displayName: string; username: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 32px; font-weight: 700; color: ${TEXT_PRIMARY}; line-height: 1.2;">
      Welcome to Marvel Card Vault, ${user.displayName}!
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      You're all set. Track your cards, monitor values, and showcase your collection—all in one place.
    </p>
    <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; border-left: 4px solid ${BRAND_RED}; margin: 20px 0;">
      <p style="margin: 0 0 10px; font-size: 14px; color: ${TEXT_PRIMARY};"><strong>Your Username:</strong> @${user.username}</p>
      <p style="margin: 0; font-size: 14px; color: ${TEXT_SECONDARY};">Ready to organize your Marvel collection</p>
    </div>
    ${ctaButton('Track Your Collection', 'https://marvelcardvault.com/browse')}
  `;
  return baseTemplate({ title: 'Welcome to Marvel Card Vault', bodyHtml });
}

/**
 * 2. Password Reset Request
 */
export function passwordResetTemplate(user: { email: string }, resetLink: string): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Reset Your Password
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      We received a request to reset your password for <strong style="color: ${TEXT_PRIMARY};">${user.email}</strong>.
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Click the button below to create a new password. This link will expire in 1 hour.
    </p>
    ${ctaButton('Reset Password', resetLink)}
    <p style="margin: 20px 0 0; font-size: 14px; color: ${TEXT_SECONDARY};">
      If you didn't request this, you can safely ignore this email.
    </p>
  `;
  return baseTemplate({ title: 'Reset Your Password', bodyHtml });
}

/**
 * 3. Password Reset Confirmation
 */
export function passwordResetConfirmationTemplate(user: { displayName: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Password Changed Successfully ✅
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Hi ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Your password has been successfully updated. You can now log in with your new password.
    </p>
    <p style="margin: 0; font-size: 14px; color: ${TEXT_SECONDARY};">
      If you didn't make this change, please contact support immediately.
    </p>
  `;
  return baseTemplate({ title: 'Password Changed', bodyHtml });
}

/**
 * 4. Badge Unlocked
 */
export function badgeUnlockedTemplate(
  user: { displayName: string },
  badgeInfo: { name: string; description: string; icon?: string }
): string {
  const bodyHtml = `
    <div style="text-align: center; padding: 20px 0;">
      <div style="font-size: 64px; margin-bottom: 20px;">🏆</div>
      <h1 style="margin: 0 0 10px; font-size: 32px; font-weight: 700; color: ${BRAND_RED};">
        Achievement Unlocked
      </h1>
    </div>
    <div style="background-color: ${DARK_BG}; padding: 30px; border-radius: 8px; text-align: center; margin: 20px 0;">
      <h2 style="margin: 0 0 10px; font-size: 24px; color: ${TEXT_PRIMARY};">${badgeInfo.name}</h2>
      <p style="margin: 0; font-size: 16px; color: ${TEXT_SECONDARY};">${badgeInfo.description}</p>
    </div>
    <p style="margin: 20px 0; font-size: 16px; text-align: center; color: ${TEXT_SECONDARY};">
      Nice work, ${user.displayName}.
    </p>
    ${ctaButton('View Your Achievements', 'https://marvelcardvault.com/profile/badges')}
  `;
  return baseTemplate({ title: 'Achievement Unlocked', bodyHtml });
}

/**
 * 5. New Trade Proposal
 */
export function tradeProposedTemplate(
  sender: { displayName: string; username: string },
  receiver: { displayName: string },
  trade: { id: number; offeredCards: string[]; requestedCards: string[] }
): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Trade Proposal from @${sender.username}
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Hi ${receiver.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      <strong style="color: ${TEXT_PRIMARY};">@${sender.username}</strong> wants to trade with you.
    </p>
    <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0 0 10px; font-size: 14px; color: ${TEXT_PRIMARY};"><strong>Offering:</strong></p>
      <p style="margin: 0 0 15px; font-size: 14px; color: ${TEXT_SECONDARY};">${trade.offeredCards.slice(0, 3).join(', ')}${trade.offeredCards.length > 3 ? ` +${trade.offeredCards.length - 3} more` : ''}</p>
      <p style="margin: 0 0 10px; font-size: 14px; color: ${TEXT_PRIMARY};"><strong>Requesting:</strong></p>
      <p style="margin: 0; font-size: 14px; color: ${TEXT_SECONDARY};">${trade.requestedCards.slice(0, 3).join(', ')}${trade.requestedCards.length > 3 ? ` +${trade.requestedCards.length - 3} more` : ''}</p>
    </div>
    ${ctaButton('Review Trade', `https://marvelcardvault.com/trades/${trade.id}`)}
  `;
  return baseTemplate({ title: 'Trade Proposal', bodyHtml });
}

/**
 * 6. Trade Accepted
 */
export function tradeAcceptedTemplate(
  user: { displayName: string },
  trade: { id: number; partnerUsername: string }
): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${BRAND_RED};">
      Trade Accepted
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      <strong style="color: ${TEXT_PRIMARY};">@${trade.partnerUsername}</strong> accepted your trade.
    </p>
    ${ctaButton('View Trade', `https://marvelcardvault.com/trades/${trade.id}`)}
  `;
  return baseTemplate({ title: 'Trade Accepted', bodyHtml });
}

/**
 * 7. Trade Declined
 */
export function tradeDeclinedTemplate(
  user: { displayName: string },
  trade: { id: number; partnerUsername: string }
): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Trade Update
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      <strong style="color: ${TEXT_PRIMARY};">@${trade.partnerUsername}</strong> declined your trade.
    </p>
    ${ctaButton('Find Other Collectors', 'https://marvelcardvault.com/community')}
  `;
  return baseTemplate({ title: 'Trade Declined', bodyHtml });
}

/**
 * 8. Card Image Approved
 */
export function cardImageApprovedTemplate(
  user: { displayName: string },
  card: { name: string; imageUrl?: string }
): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${BRAND_RED};">
      Image Approved
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Your image for <strong style="color: ${TEXT_PRIMARY};">${card.name}</strong> is now live.
    </p>
    ${card.imageUrl ? `
      <div style="text-align: center; margin: 20px 0;">
        <img src="${card.imageUrl}" alt="${card.name}" style="max-width: 200px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
      </div>
    ` : ''}
    <p style="margin: 20px 0 0; font-size: 14px; text-align: center; color: ${TEXT_SECONDARY};">
      Thanks for contributing.
    </p>
  `;
  return baseTemplate({ title: 'Image Approved', bodyHtml });
}

/**
 * 9. Card Image Rejected
 */
export function cardImageRejectedTemplate(
  user: { displayName: string },
  card: { name: string; reason?: string }
): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Card Image Update
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Hi ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Your submitted image for <strong style="color: ${TEXT_PRIMARY};">${card.name}</strong> didn't meet our quality guidelines.
    </p>
    ${card.reason ? `
      <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; border-left: 4px solid #F59E0B; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: ${TEXT_SECONDARY};"><strong style="color: ${TEXT_PRIMARY};">Reason:</strong> ${card.reason}</p>
      </div>
    ` : ''}
    <p style="margin: 20px 0 0; font-size: 14px; color: ${TEXT_SECONDARY};">
      Feel free to submit a new image that meets our guidelines.
    </p>
  `;
  return baseTemplate({ title: 'Card Image Update', bodyHtml });
}

/**
 * 10. Upcoming Set Reminder (Admin Triggered)
 */
export function newSetNotificationTemplate(
  user: { displayName: string },
  setInfo: { name: string; releaseDate: string; imageUrl?: string }
): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 32px; font-weight: 700; color: ${BRAND_RED};">
      New Set Incoming
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      A new Marvel set is releasing soon.
    </p>
    ${setInfo.imageUrl ? `
      <div style="text-align: center; margin: 20px 0;">
        <img src="${setInfo.imageUrl}" alt="${setInfo.name}" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
      </div>
    ` : ''}
    <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h2 style="margin: 0 0 10px; font-size: 24px; color: ${TEXT_PRIMARY};">${setInfo.name}</h2>
      <p style="margin: 0; font-size: 16px; color: ${TEXT_SECONDARY};"><strong>Releases:</strong> ${setInfo.releaseDate}</p>
    </div>
    ${ctaButton('See Upcoming Sets', 'https://marvelcardvault.com/upcoming-sets')}
  `;
  return baseTemplate({ title: 'New Set Incoming', bodyHtml });
}

// =============================================================================
// BEHAVIORAL / NUDGE TEMPLATES
// =============================================================================

/**
 * 11. Add First Card
 */
export function addFirstCardTemplate(user: { displayName: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Track Your First Card
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      You haven't added any cards yet. Search our database of <strong style="color: ${TEXT_PRIMARY};">60,000+ Marvel cards</strong> to start organizing your collection.
    </p>
    ${ctaButton('Add Your Cards', 'https://marvelcardvault.com/browse')}
  `;
  return baseTemplate({ title: 'Track Your First Card', bodyHtml });
}

/**
 * 12. Complete Your Collection Setup
 */
export function finishSetupTemplate(user: { displayName: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Finish Your Profile
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Complete your profile to get the most out of Marvel Card Vault:
    </p>
    <ul style="margin: 0 0 20px; padding-left: 20px; color: ${TEXT_SECONDARY};">
      <li style="margin-bottom: 10px;">Track your favorite sets</li>
      <li style="margin-bottom: 10px;">Connect with collectors</li>
      <li style="margin-bottom: 10px;">Set up trade preferences</li>
      <li>Showcase your collection</li>
    </ul>
    ${ctaButton('Update Profile', 'https://marvelcardvault.com/profile/edit')}
  `;
  return baseTemplate({ title: 'Finish Your Profile', bodyHtml });
}

/**
 * 13. 7-Day Inactivity Reminder
 */
export function inactiveUserTemplate(user: { displayName: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      What's New
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Here's what's been added since your last visit:
    </p>
    <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <ul style="margin: 0; padding-left: 20px; color: ${TEXT_SECONDARY};">
        <li style="margin-bottom: 10px;">New card sets in the database</li>
        <li style="margin-bottom: 10px;">Updated market prices</li>
        <li>New collectors joined</li>
      </ul>
    </div>
    ${ctaButton("See What's New", 'https://marvelcardvault.com')}
  `;
  return baseTemplate({ title: "What's New", bodyHtml });
}

/**
 * 14. Collection Milestone
 */
export function collectionMilestoneTemplate(
  user: { displayName: string },
  milestone: { count: number; type: string }
): string {
  const bodyHtml = `
    <div style="text-align: center; padding: 20px 0;">
      <div style="font-size: 64px; margin-bottom: 20px;">🎊</div>
      <h1 style="margin: 0 0 10px; font-size: 32px; font-weight: 700; color: ${BRAND_RED};">
        Collection Milestone
      </h1>
    </div>
    <p style="margin: 0 0 20px; font-size: 18px; text-align: center; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <div style="background-color: ${DARK_BG}; padding: 30px; border-radius: 8px; text-align: center; margin: 20px 0;">
      <h2 style="margin: 0 0 10px; font-size: 48px; color: ${BRAND_RED};">${milestone.count}</h2>
      <p style="margin: 0; font-size: 20px; color: ${TEXT_PRIMARY};">${milestone.type} Tracked</p>
    </div>
    <p style="margin: 20px 0 0; font-size: 16px; text-align: center; color: ${TEXT_SECONDARY};">
      Your collection keeps growing.
    </p>
    ${ctaButton('View Your Collection', 'https://marvelcardvault.com/collection')}
  `;
  return baseTemplate({ title: 'Collection Milestone', bodyHtml });
}

/**
 * 15. Monthly "New Sets Added" Digest
 */
export function weeklyDigestTemplate(
  user: { displayName: string },
  sets: Array<{ name: string; cardCount: number }>
): string {
  const setsHtml = sets.map(set => `
    <div style="background-color: ${CARD_BG}; padding: 15px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid ${BRAND_RED};">
      <p style="margin: 0 0 5px; font-size: 16px; color: ${TEXT_PRIMARY}; font-weight: 600;">${set.name}</p>
      <p style="margin: 0; font-size: 14px; color: ${TEXT_SECONDARY};">${set.cardCount} cards</p>
    </div>
  `).join('');

  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY};">
      Monthly Update
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Here's what's new this month:
    </p>
    <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin: 0 0 15px; font-size: 18px; color: ${TEXT_PRIMARY};">New Sets (${sets.length})</h3>
      ${setsHtml || '<p style="margin: 0; color: ${TEXT_SECONDARY};">No new sets this month</p>'}
    </div>
    ${ctaButton('See New Sets', 'https://marvelcardvault.com/browse')}
  `;
  return baseTemplate({ title: 'Monthly Update', bodyHtml });
}

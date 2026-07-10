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
function baseTemplate({ title, bodyHtml, preheader }: { title: string; bodyHtml: string; preheader?: string }): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ${DARK_BG}; color: ${TEXT_PRIMARY};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${DARK_BG};">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: ${CARD_BG}; border-radius: 12px; overflow: hidden;">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, ${DARK_BG} 0%, ${CARD_BG} 100%);">
              <img src="${LOGO_URL}" alt="Marvelous Card Vault" style="width: 150px; height: auto; display: block; margin: 0 auto;">
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
                <strong style="color: ${BRAND_RED};">Marvelous Card Vault</strong><br>
                Your Ultimate Marvel Trading Card Collection Manager
              </p>
              <p style="margin: 0; font-size: 12px; color: ${TEXT_SECONDARY};">
                <a href="https://www.marvelcardvault.com" style="color: ${BRAND_RED}; text-decoration: none;">Visit Website</a> |
                <a href="https://www.marvelcardvault.com/settings" style="color: ${BRAND_RED}; text-decoration: none;">Email Preferences</a>
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
      Welcome to Marvelous Card Vault, ${user.displayName}!
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      You're all set. Track your cards, monitor values, and showcase your collection—all in one place.
    </p>
    <div style="background-color: ${DARK_BG}; padding: 20px; border-radius: 8px; border-left: 4px solid ${BRAND_RED}; margin: 20px 0;">
      <p style="margin: 0 0 10px; font-size: 14px; color: ${TEXT_PRIMARY};"><strong>Your Username:</strong> @${user.username}</p>
      <p style="margin: 0; font-size: 14px; color: ${TEXT_SECONDARY};">Ready to organize your Marvel collection</p>
    </div>
    ${ctaButton('Track Your Collection', 'https://www.marvelcardvault.com')}
  `;
  return baseTemplate({ title: 'Welcome to Marvelous Card Vault', bodyHtml });
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
    ${ctaButton('View Your Achievements', 'https://www.marvelcardvault.com/profile/badges')}
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
    ${ctaButton('Review Trade', `https://www.marvelcardvault.com/trades/${trade.id}`)}
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
    ${ctaButton('View Trade', `https://www.marvelcardvault.com/trades/${trade.id}`)}
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
    ${ctaButton('Find Other Collectors', 'https://www.marvelcardvault.com/community')}
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
    ${ctaButton('See Upcoming Sets', 'https://www.marvelcardvault.com/upcoming-sets')}
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
    ${ctaButton('Add Your Cards', 'https://www.marvelcardvault.com')}
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
      Complete your profile to get the most out of Marvelous Card Vault:
    </p>
    <ul style="margin: 0 0 20px; padding-left: 20px; color: ${TEXT_SECONDARY};">
      <li style="margin-bottom: 10px;">Track your favorite sets</li>
      <li style="margin-bottom: 10px;">Connect with collectors</li>
      <li style="margin-bottom: 10px;">Set up trade preferences</li>
      <li>Showcase your collection</li>
    </ul>
    ${ctaButton('Update Profile', 'https://www.marvelcardvault.com/profile/edit')}
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
    ${ctaButton("See What's New", 'https://www.marvelcardvault.com')}
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
    ${ctaButton('View Your Collection', 'https://www.marvelcardvault.com/collection')}
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
    ${ctaButton('See New Sets', 'https://www.marvelcardvault.com')}
    <div style="background-color: ${DARK_BG}; padding: 25px; border-radius: 8px; margin: 30px 0 20px; border: 2px solid ${BRAND_RED}; text-align: center;">
      <p style="margin: 0 0 5px; font-size: 12px; color: ${BRAND_RED}; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Now on iOS</p>
      <h3 style="margin: 0 0 10px; font-size: 20px; color: ${TEXT_PRIMARY};">Marvelous Card Vault is on the App Store!</h3>
      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: ${TEXT_SECONDARY};">
        Manage your Marvel card collection on the go with our free iOS app. Track your binder, hunt inserts, and browse the full database — right from your iPhone.
      </p>
      <a href="https://apps.apple.com/us/app/marvelous-card-vault/id6759801987"
         style="display: inline-block; background-color: ${BRAND_RED}; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 700; letter-spacing: 0.5px;">
        Download on the App Store
      </a>
    </div>
    <div style="background-color: ${DARK_BG}; padding: 25px; border-radius: 8px; margin: 20px 0; border: 1px solid #2d3748; text-align: center;">
      <p style="margin: 0 0 5px; font-size: 12px; color: ${BRAND_RED}; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Feature Spotlight</p>
      <h3 style="margin: 0 0 10px; font-size: 20px; color: ${TEXT_PRIMARY};">Share Your Collection</h3>
      <p style="margin: 0 0 15px; font-size: 14px; line-height: 1.5; color: ${TEXT_SECONDARY};">
        Share your binder with anyone — no account needed to view. Open any set in your collection and tap the <strong style="color: ${TEXT_PRIMARY};">Share</strong> button to get a shareable link.
      </p>
    </div>
    <div style="background: linear-gradient(135deg, #1a0a0a 0%, ${DARK_BG} 100%); padding: 25px; border-radius: 8px; margin: 20px 0; border: 2px solid ${BRAND_RED};">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding-right: 16px; vertical-align: top; width: 48px;">
            <div style="width: 44px; height: 44px; background-color: ${BRAND_RED}; border-radius: 10px; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 44px; font-size: 22px;">
              📷
            </div>
          </td>
          <td style="vertical-align: top;">
            <p style="margin: 0 0 4px; font-size: 12px; color: ${BRAND_RED}; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">New Feature</p>
            <p style="margin: 0 0 10px; font-size: 20px; font-weight: 700; color: ${TEXT_PRIMARY};">Scan to Add</p>
            <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: ${TEXT_SECONDARY};">
              Adding cards to your vault just got a whole lot faster. Use the new <strong style="color: ${TEXT_PRIMARY};">Scan to Add</strong> feature to photograph any Marvel card and we'll automatically identify it and add it to your collection — no typing required.
            </p>
            <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: ${TEXT_SECONDARY};">
              Not sure of an exact match? The built-in <strong style="color: ${TEXT_PRIMARY};">Card Picker</strong> lets you drill down by year, set, and subset to find the right card manually in seconds.
            </p>
            <a href="https://www.marvelcardvault.com/scan"
               style="display: inline-block; background-color: ${BRAND_RED}; color: #ffffff; text-decoration: none; padding: 11px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; letter-spacing: 0.5px;">
              Try Scan to Add →
            </a>
          </td>
        </tr>
      </table>
    </div>
  `;
  return baseTemplate({ title: 'Monthly Update', bodyHtml });
}

/**
 * 16. Google Play Store Launch Announcement
 */
/**
 * THANKS2U Coupon Blast — Non-upgraded users
 * Promotes app store availability with 2 months free (code: THANKS2U, first 100 users)
 */
export function thanks2uCouponTemplate(user: { displayName: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 16px; font-size: 30px; font-weight: 700; color: ${TEXT_PRIMARY}; line-height: 1.2;">
      🎉 A Gift From Us to You!
    </h1>
    <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.7; color: ${TEXT_SECONDARY};">
      Hey ${user.displayName}! 👋
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: ${TEXT_SECONDARY};">
      We just want to say — <strong style="color: ${TEXT_PRIMARY};">thank you</strong> for being a part of Marvelous Card Vault. Your support means the world to us, and we've got some exciting news to share!
    </p>

    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #1E293B 100%); border-radius: 12px; padding: 28px; margin: 24px 0; border: 1px solid #334155; text-align: center;">
      <p style="margin: 0 0 6px; font-size: 13px; color: ${TEXT_SECONDARY}; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">📱 Now Available on Both App Stores!</p>
      <p style="margin: 0 0 20px; font-size: 20px; font-weight: 700; color: ${TEXT_PRIMARY};">Marvelous Card Vault is on iOS & Android</p>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="text-align: center; padding: 6px 8px;">
            <a href="https://apps.apple.com/us/app/marvelous-card-vault/id6759801987" style="display: inline-block; padding: 12px 22px; background-color: #000000; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
              🍎 Download on the App Store
            </a>
          </td>
        </tr>
        <tr>
          <td style="text-align: center; padding: 6px 8px;">
            <a href="https://play.google.com/store/apps/details?id=com.marvelcardvault.app&hl=en_US" style="display: inline-block; padding: 12px 22px; background-color: #01875f; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
              🤖 Get it on Google Play
            </a>
          </td>
        </tr>
      </table>
    </div>

    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: ${TEXT_SECONDARY};">
      And because you're awesome, we're giving you something special — <strong style="color: ${TEXT_PRIMARY};">2 months of Super Hero for completely free</strong>. That means unlimited cards, advanced stats, and all the premium features with no strings attached. 🦸
    </p>

    <div style="background-color: ${DARK_BG}; padding: 28px; border-radius: 12px; text-align: center; margin: 24px 0; border: 2px dashed ${BRAND_RED};">
      <p style="margin: 0 0 8px; font-size: 13px; color: ${TEXT_SECONDARY}; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Your Exclusive Promo Code</p>
      <div style="margin: 12px 0;">
        <span style="font-size: 36px; font-weight: 800; color: ${BRAND_RED}; letter-spacing: 5px; font-family: monospace;">THANKS2U</span>
      </div>
      <p style="margin: 8px 0 0; font-size: 14px; color: ${TEXT_SECONDARY};">2 months free · First 100 users only · Don't wait!</p>
    </div>

    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: ${TEXT_SECONDARY};">
      This code is only available to the <strong style="color: ${TEXT_PRIMARY};">first 100 people</strong> who redeem it, so don't sit on this one! Head to the app and upgrade to Super Hero using code <strong style="color: ${BRAND_RED};">THANKS2U</strong> to claim your free months.
    </p>

    ${ctaButton('Claim Your 2 Free Months →', 'https://app.marvelcardvault.com/subscribe')}

    <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: ${TEXT_SECONDARY}; text-align: center;">
      Thank you for being part of our community. You make this whole thing worth it. 💙<br>
      <em>— The Marvelous Card Vault Team</em>
    </p>
  `;
  return baseTemplate({ title: '🎉 2 Months Free — Thank You!', bodyHtml });
}

// =============================================================================
// PRODUCT ANNOUNCEMENT: YOUR VAULT JUST GOT BIGGER (July 2026)
// =============================================================================

/**
 * Vault Upgrade Announcement — Side Kick 500-card limit + PC Binders launch.
 * Returns both HTML (for email clients) and plain-text (fallback).
 */
export function vaultUpgradeAnnouncementTemplate(): { html: string; text: string } {
  const APP_URL = 'https://www.marvelcardvault.com';
  const GOLD = '#F59E0B';

  const bodyHtml = `
    <!-- Hero heading -->
    <h1 style="margin: 0 0 8px; font-size: 30px; font-weight: 800; color: ${TEXT_PRIMARY}; line-height: 1.2; letter-spacing: -0.5px;">
      Your Vault Just Got Bigger.
    </h1>
    <p style="margin: 0 0 28px; font-size: 16px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
      Hey collector,
    </p>
    <p style="margin: 0 0 28px; font-size: 16px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
      Your Marvel Card Vault just got a serious upgrade.
    </p>

    <!-- Section 1: Side Kick 500 cards -->
    <p style="margin: 0 0 12px; font-size: 14px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
      First, we made more room for Side Kick members.
    </p>
    <div style="background-color: ${DARK_BG}; border-left: 4px solid ${BRAND_RED}; border-radius: 0 8px 8px 0; padding: 20px 24px; margin: 0 0 28px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 600; color: ${TEXT_SECONDARY}; text-transform: uppercase; letter-spacing: 1.5px;">Side Kick Update</p>
      <p style="margin: 0 0 10px; font-size: 22px; font-weight: 700; color: ${TEXT_PRIMARY};">500 Cards — Double the Limit</p>
      <p style="margin: 0; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
        Side Kick now lets you track up to <strong style="color: ${TEXT_PRIMARY};">500 cards</strong> — double the previous 250-card limit. That means more room to build your collection, organize your vault, and keep growing without hitting the wall as quickly.
      </p>
    </div>

    <!-- Section 2: PC Binders -->
    <p style="margin: 0 0 12px; font-size: 16px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
      We also rolled out one of our favorite new Super Hero features:
    </p>
    <div style="background-color: ${DARK_BG}; border-left: 4px solid ${GOLD}; border-radius: 0 8px 8px 0; padding: 20px 24px; margin: 0 0 20px;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 600; color: ${GOLD}; text-transform: uppercase; letter-spacing: 1.5px;">Super Hero Feature</p>
      <p style="margin: 0 0 10px; font-size: 26px; font-weight: 800; color: ${TEXT_PRIMARY};">PC Binders.</p>
      <p style="margin: 0 0 14px; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
        PC Binders let you build your own custom private collection binders around the cards that matter most to you.
      </p>
      <p style="margin: 0; font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
        Building a Spider-Man PC? Chasing Venom cards? Tracking your favorite artist, team, theme, insert run, or personal grail list? Create a PC Binder, add cards you already own, add cards you're still chasing, and track your progress as you build.
      </p>
    </div>

    <!-- PC Binder screenshot -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="text-align: center; padding: 0 0 28px;">
          <img
            src="https://res.cloudinary.com/dgu7hjfvn/image/upload/v1783696264/marvel-card-vault/email-assets/pc-binder-screenshot.png"
            alt="PC Binder — Sabretooth PC showing 28 of 500 collected"
            width="280"
            style="width: 280px; max-width: 100%; height: auto; border-radius: 16px; display: inline-block; border: 2px solid #334155;"
          >
        </td>
      </tr>
    </table>

    <!-- What's new bullet list -->
    <div style="background-color: ${DARK_BG}; border-radius: 8px; padding: 20px 24px; margin: 0 0 28px;">
      <p style="margin: 0 0 14px; font-size: 14px; font-weight: 600; color: ${TEXT_PRIMARY}; text-transform: uppercase; letter-spacing: 1px;">What's new</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td style="padding: 5px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right: 10px; vertical-align: top; color: ${BRAND_RED}; font-size: 16px; line-height: 1.5;">&#8594;</td>
              <td style="font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.5;">Side Kick now tracks up to <strong style="color: ${TEXT_PRIMARY};">500 cards</strong></td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding: 5px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right: 10px; vertical-align: top; color: ${GOLD}; font-size: 16px; line-height: 1.5;">&#8594;</td>
              <td style="font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.5;"><strong style="color: ${TEXT_PRIMARY};">Super Hero members</strong> can now create PC Binders</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding: 5px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right: 10px; vertical-align: top; color: ${GOLD}; font-size: 16px; line-height: 1.5;">&#8594;</td>
              <td style="font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.5;">Build custom private binders by character, artist, theme, chase list, or whatever you collect</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding: 5px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right: 10px; vertical-align: top; color: ${GOLD}; font-size: 16px; line-height: 1.5;">&#8594;</td>
              <td style="font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.5;">Add both owned cards and cards you're still chasing</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding: 5px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right: 10px; vertical-align: top; color: ${GOLD}; font-size: 16px; line-height: 1.5;">&#8594;</td>
              <td style="font-size: 15px; color: ${TEXT_SECONDARY}; line-height: 1.5;">Track progress toward your personal collecting goals</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </div>

    <p style="margin: 0 0 8px; font-size: 16px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
      PC Binders are available now for Super Hero members.
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: ${TEXT_SECONDARY}; line-height: 1.6;">
      Open Marvel Card Vault and start building your PC.
    </p>

    ${ctaButton('Open Marvel Card Vault', APP_URL)}

    <!-- Disclaimer + unsubscribe -->
    <p style="margin: 28px 0 0; font-size: 12px; color: ${TEXT_SECONDARY}; line-height: 1.6; text-align: center; border-top: 1px solid #334155; padding-top: 20px;">
      Marvel Card Vault is not affiliated with Marvel, Disney, Upper Deck, Topps, or any card manufacturer.<br>
      You're receiving this because you have an account at Marvel Card Vault.<br>
      <a href="{{UNSUBSCRIBE_URL}}" style="color: ${BRAND_RED}; text-decoration: underline;">Unsubscribe from these emails</a>
      &nbsp;&middot;&nbsp;
      <a href="${APP_URL}/settings" style="color: ${BRAND_RED}; text-decoration: none;">Manage email preferences</a>
    </p>
  `;

  const html = baseTemplate({
    title: 'Your Vault Just Got Bigger',
    bodyHtml,
    preheader: 'Side Kick now tracks up to 500 cards, and Super Hero members can build custom PC Binders.',
  });

  const text = `
YOUR VAULT JUST GOT BIGGER

Hey collector,

Your Marvel Card Vault just got a serious upgrade.

SIDE KICK UPDATE — 500 CARDS

Side Kick now lets you track up to 500 cards — double the previous 250-card limit. That means more room to build your collection, organize your vault, and keep growing.

SUPER HERO FEATURE — PC BINDERS

PC Binders let you build your own custom private collection binders around the cards that matter most to you. Build around a character, artist, theme, chase list, or whatever you collect.

You can add cards you already own, add cards you're still chasing, and track your progress as you build.

WHAT'S NEW:
- Side Kick now tracks up to 500 cards
- Super Hero members can create PC Binders
- Build custom private binders by character, artist, theme, chase list, or collecting goal
- Add both owned cards and cards you're still chasing
- Track progress toward your personal collection goals

PC Binders are available now for Super Hero members.

Open Marvel Card Vault and start building your PC:
${APP_URL}

---
Marvel Card Vault is not affiliated with Marvel, Disney, Upper Deck, Topps, or any card manufacturer.
Unsubscribe from these emails: {{UNSUBSCRIBE_URL}}
Manage email preferences: ${APP_URL}/settings
`.trim();

  return { html, text };
}

export function googlePlayLaunchTemplate(user: { displayName: string }): string {
  const bodyHtml = `
    <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: ${TEXT_PRIMARY}; text-align: center;">
      Marvelous Card Vault is Now on Google Play!
    </h1>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      Hey ${user.displayName},
    </p>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      We're thrilled to announce that <strong style="color: ${TEXT_PRIMARY};">Marvelous Card Vault is officially available on the Google Play Store!</strong> Now you can manage your Marvel trading card collection on the go with our brand new Android app.
    </p>
    <div style="background-color: ${DARK_BG}; padding: 25px; border-radius: 8px; text-align: center; margin: 25px 0; border: 2px solid ${BRAND_RED};">
      <p style="margin: 0 0 10px; font-size: 14px; color: ${TEXT_SECONDARY}; text-transform: uppercase; letter-spacing: 1px;">Beta User Exclusive</p>
      <p style="margin: 0 0 5px; font-size: 24px; font-weight: 700; color: ${TEXT_PRIMARY};">3 Months Free</p>
      <p style="margin: 0 0 15px; font-size: 16px; color: ${TEXT_SECONDARY};">Use promo code:</p>
      <div style="background-color: ${CARD_BG}; display: inline-block; padding: 12px 30px; border-radius: 6px; border: 1px dashed ${BRAND_RED};">
        <span style="font-size: 28px; font-weight: 700; color: ${BRAND_RED}; letter-spacing: 3px;">WNFREE3</span>
      </div>
    </div>
    <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">
      As one of our early supporters, you get exclusive access to this promo code. Download the app and enter <strong style="color: ${TEXT_PRIMARY};">WNFREE3</strong> to unlock 3 months of premium features absolutely free!
    </p>
    ${ctaButton('Download on Google Play', 'https://play.google.com/store/apps/details?id=com.marvelcardvault.app&utm_source=na_Med')}
    <p style="margin: 20px 0 0; font-size: 14px; text-align: center; color: ${TEXT_SECONDARY};">
      Thank you for being part of the Marvelous Card Vault community!
    </p>
  `;
  return baseTemplate({ title: 'MCV now available on Google Play', bodyHtml });
}

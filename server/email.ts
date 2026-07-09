/**
 * server/email.ts — thin wrapper used by direct routes.ts call sites.
 * All sends now go through Resend via emailService.sendResendEmail.
 *
 * Remaining Brevo usage in the codebase:
 *   - server/contactsSync.ts (syncFirebaseUsersToBrevo) — Brevo Contacts REST API
 *     for contact-list management only; not email sending. Kept on Brevo intentionally.
 */
import { sendResendEmail } from './services/emailService';

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  await sendResendEmail({ to, subject, html, template: 'direct' });
}

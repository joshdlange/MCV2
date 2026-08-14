/**
 * server/email.ts — thin wrapper used by direct routes.ts call sites.
 * All sends now go through Resend via emailService.sendResendEmail.
 *
 * Brevo fully retired (Aug 2026): contact sync removed; all email via Resend.
 */
import { sendResendEmail } from './services/emailService';

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  await sendResendEmail({ to, subject, html, template: 'direct' });
}

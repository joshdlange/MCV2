import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { db } from '../db';
import { emailLogs, users } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { passwordResetTemplate } from './emailTemplates';

const DEFAULT_FROM = 'Marvelous Card Vault <no-reply@marvelcardvault.com>';

// ============================================================
// Brevo SMTP transport (legacy provider — still used by all
// email flows EXCEPT password reset; see sendEmail below)
// ============================================================

const transporter: Transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY,
  },
});

// ============================================================
// Resend client (new provider — password reset + future flows)
// Lazily initialized so a missing RESEND_API_KEY never crashes
// unrelated app functionality at startup.
// ============================================================

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY is not configured. Add it to Replit Secrets to enable Resend email sending.'
    );
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function logEmailToDb(
  to: string,
  subject: string,
  template: string,
  jobName?: string
): Promise<void> {
  try {
    let userId: number | null = null;
    try {
      const user = await db.select({ id: users.id })
        .from(users)
        .where(eq(users.email, to))
        .limit(1);
      userId = user[0]?.id || null;
    } catch (error) {
      console.warn(`Could not find userId for email ${to}`);
    }

    await db.insert(emailLogs).values({
      userId,
      email: to,
      template,
      subject,
      jobName: jobName || null,
    });
  } catch (error) {
    // Audit logging must never block the actual email send
    console.warn(`Could not write email_logs entry for ${to}:`, error);
  }
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  template?: string;
  jobName?: string;
}

export interface ResendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  template?: string;
  jobName?: string;
}

/**
 * Centralized email sending service using Brevo SMTP (legacy provider)
 * Logs every email send to the database for audit trail
 *
 * @param to Recipient email address
 * @param subject Email subject line
 * @param html HTML content of the email
 * @param template Template name (for tracking)
 * @param jobName Cron job name (if sent from cron)
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  template: string = 'unknown',
  jobName?: string
): Promise<void> {
  try {
    await logEmailToDb(to, subject, template, jobName);

    // Send email via Brevo
    const info = await transporter.sendMail({
      from: DEFAULT_FROM,
      to,
      subject,
      html,
    });

    console.log(`✅ Email sent to ${to} | Template: ${template} | Job: ${jobName || 'immediate'} | Message ID: ${info.messageId}`);
  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    throw error;
  }
}

/**
 * Centralized email sending via Resend (new provider)
 * Currently used for: password reset emails, admin Resend test emails.
 * Future email types (welcome, announcements, digests) should migrate here.
 *
 * Logs every send to the email_logs table and console-logs success/failure.
 * Throws a clear error if RESEND_API_KEY is missing — callers must handle it.
 */
export async function sendResendEmail(options: ResendEmailOptions): Promise<string | undefined> {
  const {
    to,
    subject,
    html,
    text,
    from = DEFAULT_FROM,
    replyTo,
    template = 'unknown',
    jobName,
  } = options;

  let client: Resend;
  try {
    client = getResendClient();
  } catch (error) {
    console.error(`❌ [Resend] Cannot send email to ${to} | Template: ${template} | ${error instanceof Error ? error.message : error}`);
    throw error;
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      throw new Error(`Resend API error: ${error.name || 'unknown'} — ${error.message || JSON.stringify(error)}`);
    }

    await logEmailToDb(to, subject, template, jobName);
    console.log(`✅ [Resend] Email sent to ${to} | Template: ${template} | Job: ${jobName || 'immediate'} | Message ID: ${data?.id}`);
    return data?.id;
  } catch (error) {
    console.error(`❌ [Resend] Error sending email to ${to} | Template: ${template}:`, error);
    throw error;
  }
}

/**
 * Send a branded password reset email via Resend.
 * The reset link itself is generated by Firebase Auth (token generation,
 * expiration, and validation are fully handled by Firebase) — this function
 * only wraps the link in the branded template and delivers it.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  userName?: string;
}): Promise<void> {
  const { to, resetUrl } = params;
  const html = passwordResetTemplate({ email: to }, resetUrl);
  await sendResendEmail({
    to,
    subject: 'Reset Your Password',
    html,
    template: 'password-reset',
  });
}

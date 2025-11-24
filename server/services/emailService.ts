import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { db } from '../db';
import { emailLogs, users } from '../../shared/schema';
import { eq } from 'drizzle-orm';

const transporter: Transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY,
  },
});

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  template?: string;
  jobName?: string;
}

/**
 * Centralized email sending service using Brevo SMTP
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
    // Look up userId by email for logging
    let userId: number | null = null;
    try {
      const user = await db.select({ id: users.id })
        .from(users)
        .where(eq(users.email, to))
        .limit(1);
      userId = user[0]?.id || null;
    } catch (error) {
      // If user lookup fails, continue without userId
      console.warn(`Could not find userId for email ${to}`);
    }

    // Log email send to database
    await db.insert(emailLogs).values({
      userId,
      email: to,
      template,
      subject,
      jobName: jobName || null,
    });

    // Send email via Brevo
    const info = await transporter.sendMail({
      from: 'Marvel Card Vault <no-reply@marvelcardvault.com>',
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

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const transporter: Transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY,
  },
});

/**
 * Centralized email sending service using Brevo SMTP
 * @param to Recipient email address
 * @param subject Email subject line
 * @param html HTML content of the email
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  try {
    const info = await transporter.sendMail({
      from: 'Marvel Card Vault <no-reply@marvelcardvault.com>',
      to,
      subject,
      html,
    });
    console.log(`✅ Email sent successfully to ${to} - Message ID: ${info.messageId}`);
  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    throw error;
  }
}

/**
 * One-shot test: sends the vault upgrade announcement email to a single address.
 * Run with: npx tsx scripts/send-vault-upgrade-test.ts josh@marvelcardvault.com
 * Delete this file after the campaign is approved and sent.
 */
import { sendResendEmail } from '../server/services/emailService';
import { vaultUpgradeAnnouncementTemplate } from '../server/services/emailTemplates';

const to = process.argv[2] || 'josh@marvelcardvault.com';

(async () => {
  console.log(`Sending vault upgrade test email to: ${to}`);
  const { html, text } = vaultUpgradeAnnouncementTemplate();
  const messageId = await sendResendEmail({
    to,
    subject: 'Your Vault Just Got Bigger',
    html,
    text,
    template: 'vault-upgrade-announcement',
    jobName: 'campaign-vault-upgrade-test',
  });
  console.log(`✅ Sent successfully. Resend message ID: ${messageId}`);
})().catch(err => {
  console.error('❌ Send failed:', err.message);
  process.exit(1);
});

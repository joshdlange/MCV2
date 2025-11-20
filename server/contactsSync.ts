import admin from 'firebase-admin';
import * as brevo from '@getbrevo/brevo';

export async function syncFirebaseUsersToBrevo(): Promise<void> {
  try {
    console.log('Starting Firebase → Brevo contact sync...');

    // Initialize Brevo API client
    const apiInstance = new brevo.ContactsApi();
    apiInstance.setApiKey(
      brevo.ContactsApiApiKeys.apiKey,
      process.env.BREVO_SMTP_KEY || ''
    );

    // Paginate through all Firebase users
    let pageToken: string | undefined;
    let totalSynced = 0;
    let totalSkipped = 0;

    do {
      const listUsersResult = await admin.auth().listUsers(1000, pageToken);
      
      for (const user of listUsersResult.users) {
        if (!user.email) {
          console.log(`Skipping user ${user.uid} - no email`);
          totalSkipped++;
          continue;
        }

        try {
          // Prepare contact data
          const createContact = new brevo.CreateContact();
          createContact.email = user.email;
          createContact.attributes = {
            FIREBASE_ID: user.uid,
            DISPLAY_NAME: user.displayName || '',
            EMAIL_VERIFIED: user.emailVerified ? 'true' : 'false',
          };

          // Create contact in Brevo
          await apiInstance.createContact(createContact);
          console.log(`Synced: ${user.email}`);
          totalSynced++;
        } catch (error: any) {
          // Skip duplicates gracefully
          if (error.response?.body?.code === 'duplicate_parameter') {
            console.log(`Skipped duplicate: ${user.email}`);
            totalSkipped++;
          } else {
            console.error(`Error syncing ${user.email}:`, error.message);
            totalSkipped++;
          }
        }
      }

      pageToken = listUsersResult.pageToken;
    } while (pageToken);

    console.log(`
✅ Firebase → Brevo sync complete!
   Total synced: ${totalSynced}
   Total skipped: ${totalSkipped}
    `);
  } catch (error) {
    console.error('Error during Firebase → Brevo sync:', error);
    throw error;
  }
}

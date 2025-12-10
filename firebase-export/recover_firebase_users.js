import admin from 'firebase-admin';

// Initialize Firebase Admin with your project
admin.initializeApp({
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
});

async function listAllUsers() {
  try {
    console.log('Fetching all Firebase users...');
    const listUsersResult = await admin.auth().listUsers();
    
    console.log(`Found ${listUsersResult.users.length} Firebase users:`);
    
    listUsersResult.users.forEach((userRecord, index) => {
      console.log(`${index + 1}. UID: ${userRecord.uid}`);
      console.log(`   Email: ${userRecord.email || 'No email'}`);
      console.log(`   Display Name: ${userRecord.displayName || 'No display name'}`);
      console.log(`   Created: ${userRecord.metadata.creationTime}`);
      console.log(`   Last Sign In: ${userRecord.metadata.lastSignInTime || 'Never'}`);
      console.log('---');
    });
    
    return listUsersResult.users;
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
}

// Run the script
listAllUsers().then(() => {
  process.exit(0);
}).catch(console.error);

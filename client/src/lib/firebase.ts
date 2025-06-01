import { initializeApp } from "firebase/app";
import { getAuth, signInWithRedirect, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();

// Sync user with backend after authentication
const syncUserWithBackend = async (user: any) => {
  try {
    const response = await fetch('/api/auth/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firebaseUid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log('User synced with backend:', data.user);
    } else {
      console.error('Failed to sync user with backend');
    }
  } catch (error) {
    console.error('Error syncing user:', error);
  }
};

export const signInWithGoogle = async () => {
  try {
    console.log('Starting Google sign-in...');
    
    // Use popup for deployed version, redirect for preview
    const isDeployed = window.location.hostname.includes('.replit.app');
    
    if (isDeployed) {
      // Use popup authentication for deployed version
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        console.log('User signed in:', result.user.displayName);
        await syncUserWithBackend(result.user);
      }
    } else {
      // Use redirect authentication for preview
      await signInWithRedirect(auth, provider);
    }
  } catch (error: any) {
    console.error('Google sign-in error:', error);
    throw error;
  }
};

export const signOutUser = () => {
  return signOut(auth);
};

export { onAuthStateChanged };
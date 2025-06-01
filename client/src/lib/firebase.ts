import { initializeApp } from "firebase/app";
import { getAuth, signInWithRedirect, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
  messagingSenderId: "123456789", // This is optional but some configs need it
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase with error handling
let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  throw error;
}

export { auth };

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
      
      // Update app store with backend user data
      const { useAppStore } = await import('@/lib/store');
      useAppStore.getState().setCurrentUser({
        id: data.user.id,
        name: data.user.displayName || data.user.username,
        email: data.user.email,
        avatar: data.user.photoURL || '',
        isAdmin: data.user.isAdmin,
        plan: data.user.plan,
        subscriptionStatus: data.user.subscriptionStatus
      });
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
    console.log('Firebase config check:', {
      apiKey: !!import.meta.env.VITE_FIREBASE_API_KEY,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: !!import.meta.env.VITE_FIREBASE_APP_ID,
      hostname: window.location.hostname
    });
    
    // Try popup first, fallback to redirect if popup fails
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        console.log('User signed in via popup:', result.user.displayName);
        await syncUserWithBackend(result.user);
      }
    } catch (popupError: any) {
      // If popup fails (blocked, closed, etc.), use redirect
      if (popupError.code === 'auth/popup-blocked' || 
          popupError.code === 'auth/popup-closed-by-user' ||
          popupError.code === 'auth/cancelled-popup-request') {
        console.log('Popup blocked or closed, using redirect method...');
        await signInWithRedirect(auth, provider);
        return; // Redirect will handle the rest
      }
      throw popupError;
    }
  } catch (error: any) {
    console.error('Google sign-in error details:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    
    if (error.code === 'auth/unauthorized-domain') {
      console.error('Domain not authorized in Firebase. Add this domain to Firebase Console > Authentication > Settings > Authorized domains');
    }
    
    throw error;
  }
};

export const signOutUser = () => {
  return signOut(auth);
};

export { onAuthStateChanged };
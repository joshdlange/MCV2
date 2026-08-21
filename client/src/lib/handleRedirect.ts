import { getAuth, getRedirectResult, GoogleAuthProvider } from "firebase/auth";

const auth = getAuth();

// Detect if running in native Capacitor app (Android/iOS)
function isNativeApp(): boolean {
  const w = window as any;
  if (w.Capacitor) {
    try {
      if (typeof w.Capacitor.getPlatform === 'function') {
        const platform = w.Capacitor.getPlatform();
        return platform === 'android' || platform === 'ios';
      }
      if (typeof w.Capacitor.isNativePlatform === 'function') {
        return !!w.Capacitor.isNativePlatform();
      }
    } catch {}
  }
  return false;
}

// Call this function on page load when the user is redirected back to your site
export function handleRedirect() {
  // Skip redirect handling in native apps - they use Capacitor Social Login instead
  if (isNativeApp()) {
    console.log('Native app detected, skipping redirect handling');
    return;
  }
  getRedirectResult(auth)
    .then(async (result) => {
      if (result) {
        // AuthContext owns the single authenticated backend-sync path.
        console.log('User signed in:', result.user.displayName);
      }
    })
    .catch((error) => {
      // Handle Errors here.
      const errorCode = error.code;
      const errorMessage = error.message;
      console.error('Authentication error:', errorCode, errorMessage);
      
      // The email of the user's account used.
      const email = error.customData?.email;
      // The AuthCredential type that was used.
      const credential = GoogleAuthProvider.credentialFromError(error);
    });
}
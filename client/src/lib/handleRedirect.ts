import { getAuth, getRedirectResult, GoogleAuthProvider } from "firebase/auth";

const auth = getAuth();

// Call this function on page load when the user is redirected back to your site
export function handleRedirect() {
  getRedirectResult(auth)
    .then(async (result) => {
      if (result) {
        // The signed-in user info.
        const user = result.user;
        console.log('User signed in:', user.displayName);

        // Sync user with backend
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
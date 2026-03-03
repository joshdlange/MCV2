import { SignInWithApple, SignInWithAppleResponse } from "@capacitor-community/apple-sign-in";
import {
  getAuth,
  OAuthProvider,
  signInWithCredential,
  UserCredential,
} from "firebase/auth";

const auth = getAuth();

function isIOSNativeApp(): boolean {
  const w = window as any;
  if (w.Capacitor) {
    try {
      if (typeof w.Capacitor.getPlatform === "function") {
        return w.Capacitor.getPlatform() === "ios";
      }
    } catch {}
  }
  return false;
}

export function isAppleSignInAvailable(): boolean {
  return isIOSNativeApp();
}

export async function signInWithAppleUnified(): Promise<UserCredential> {
  const result: SignInWithAppleResponse = await SignInWithApple.authorize({
    clientId: "com.marvelcardvault.app",
    redirectURI: "https://app.marvelcardvault.com",
    scopes: "email name",
  });

  const identityToken = result.response.identityToken;

  if (!identityToken) {
    throw new Error("No identity token returned from Apple Sign-In");
  }

  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken: identityToken,
    rawNonce: undefined,
  });

  return await signInWithCredential(auth, credential);
}

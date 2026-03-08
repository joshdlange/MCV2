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

function generateNonce(length: number = 32): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => charset[v % charset.length]).join("");
}

async function sha256Hash(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signInWithAppleUnified(): Promise<UserCredential> {
  const rawNonce = generateNonce();
  const hashedNonce = await sha256Hash(rawNonce);

  const result: SignInWithAppleResponse = await SignInWithApple.authorize({
    clientId: "com.marvelcardvault.app",
    redirectURI: "https://app.marvelcardvault.com",
    scopes: "email name",
    nonce: hashedNonce,
  });

  const identityToken = result.response.identityToken;

  if (!identityToken) {
    throw new Error("No identity token returned from Apple Sign-In");
  }

  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken: identityToken,
    rawNonce: rawNonce,
  });

  return await signInWithCredential(auth, credential);
}

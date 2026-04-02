import { SignInWithApple, SignInWithAppleResponse } from "@capacitor-community/apple-sign-in";
import {
  getAuth,
  OAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
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
  return true;
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
  if (isIOSNativeApp()) {
    const rawNonce = generateNonce();
    const hashedNonce = await sha256Hash(rawNonce);

    console.log("[AppleSignIn] Calling native authorize (no clientId/redirectURI — native app flow)");
    const result: SignInWithAppleResponse = await SignInWithApple.authorize({
      scopes: "email name",
      nonce: hashedNonce,
    });

    console.log("[AppleSignIn] authorize returned, checking identityToken");
    const identityToken = result.response.identityToken;

    if (!identityToken) {
      console.error("[AppleSignIn] No identityToken in response:", JSON.stringify(result.response));
      throw new Error("No identity token returned from Apple Sign-In");
    }

    console.log("[AppleSignIn] identityToken present, sending to server");
    const response = await fetch("/api/auth/apple-sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken, rawNonce }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[AppleSignIn] Server verification failed:", response.status, errorData);
      throw new Error(errorData.error || "Apple Sign-In server verification failed");
    }

    const { customToken } = await response.json();
    console.log("[AppleSignIn] Custom token received, signing in with Firebase");
    return await signInWithCustomToken(auth, customToken);
  }

  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return await signInWithPopup(auth, provider);
}

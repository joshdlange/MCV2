import { SocialLogin } from "@capgo/capacitor-social-login";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  UserCredential,
} from "firebase/auth";

const auth = getAuth();

function isNativeApp(): boolean {
  const w = window as any;
  if (w.Capacitor) {
    try {
      if (typeof w.Capacitor.getPlatform === "function") {
        const platform = w.Capacitor.getPlatform();
        return platform === "android" || platform === "ios";
      }
      if (typeof w.Capacitor.isNativePlatform === "function") {
        return !!w.Capacitor.isNativePlatform();
      }
    } catch {}
  }
  return false;
}

let socialLoginInitialized = false;

async function initSocialLoginIfNeeded() {
  if (socialLoginInitialized) return;

  // Your actual Firebase Web Client ID
  const WEB_CLIENT_ID = "946426423073-rjhk84sgojd77gvkq2uf5ehrcd1l3ja9.apps.googleusercontent.com";

  await SocialLogin.initialize({
    google: {
      webClientId: WEB_CLIENT_ID,
    },
  });

  socialLoginInitialized = true;
}

export async function signInWithGoogleUnified(): Promise<UserCredential> {
  if (!isNativeApp()) {
    const provider = new GoogleAuthProvider();
    return await signInWithPopup(auth, provider);
  }

  await initSocialLoginIfNeeded();

  const res: any = await SocialLogin.login({
    provider: "google",
    options: {},
  });

  const idToken =
    res?.idToken ||
    res?.authentication?.idToken ||
    res?.credential?.idToken;

  if (!idToken) {
    console.error("SocialLogin response:", res);
    throw new Error("No idToken returned from SocialLogin Google login");
  }

  const credential = GoogleAuthProvider.credential(idToken);
  return await signInWithCredential(auth, credential);
}

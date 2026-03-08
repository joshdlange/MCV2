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
    options: {
      scopes: ["email", "profile"],
    },
  });

  console.log('SocialLogin response:', JSON.stringify(res).substring(0, 500));

  let idToken =
    res?.idToken ||
    res?.authentication?.idToken ||
    res?.credential?.idToken ||
    res?.result?.idToken ||
    res?.result?.credential?.idToken;

  if (!idToken && res?.result?.credential) {
    try {
      const credential = typeof res.result.credential === 'string'
        ? JSON.parse(res.result.credential)
        : res.result.credential;
      idToken = credential?.token || credential?.idToken;
    } catch (e) {
      console.error('Failed to parse credential:', e);
    }
  }

  if (!idToken && res?.result?.data) {
    try {
      const data = typeof res.result.data === 'string'
        ? JSON.parse(res.result.data)
        : res.result.data;
      idToken = data?.token || data?.idToken;
    } catch (e) {
      console.error('Failed to parse data:', e);
    }
  }

  if (!idToken) {
    console.error("Full SocialLogin response:", JSON.stringify(res, null, 2));
    throw new Error("No idToken returned from native Google login. Please try again.");
  }

  console.log('Successfully extracted Google idToken');
  const credential = GoogleAuthProvider.credential(idToken);
  return await signInWithCredential(auth, credential);
}

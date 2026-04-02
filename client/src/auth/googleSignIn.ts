import { SocialLogin } from "@capgo/capacitor-social-login";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  UserCredential,
} from "firebase/auth";

const auth = getAuth();

// iOS OAuth client ID — value of CLIENT_ID in GoogleService-Info.plist.
// REQUIRED on iOS: the @capgo/capacitor-social-login Swift plugin only calls
// GIDSignIn.configure() when iOSClientId is present. Without it, the native
// Google provider is never initialized and login throws "No provider was initialized."
const IOS_CLIENT_ID = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined;

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

function isIOSNative(): boolean {
  const w = window as any;
  try {
    return w.Capacitor?.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}

let socialLoginInitialized = false;

async function initSocialLoginIfNeeded() {
  if (socialLoginInitialized) return;

  const WEB_CLIENT_ID = "946426423073-rjhk84sgojd77gvkq2uf5ehrcd1l3ja9.apps.googleusercontent.com";

  const googleConfig: Record<string, unknown> = {
    webClientId: WEB_CLIENT_ID,
  };

  // iOSClientId is mandatory on iOS native — the Swift plugin skips GIDSignIn
  // initialization entirely if this key is absent, causing "No provider was initialized".
  if (IOS_CLIENT_ID) {
    googleConfig.iOSClientId = IOS_CLIENT_ID;
  }

  console.log(
    "[AuthInit] initialize start — platform:", (window as any).Capacitor?.getPlatform?.() ?? "web",
    "| iOSClientId present:", !!IOS_CLIENT_ID,
    "| webClientId:", WEB_CLIENT_ID.substring(0, 20) + "…"
  );

  if (isIOSNative() && !IOS_CLIENT_ID) {
    const msg = "[AuthInit] VITE_GOOGLE_IOS_CLIENT_ID is not set — Google Sign-In will fail on iOS. Add CLIENT_ID from GoogleService-Info.plist as VITE_GOOGLE_IOS_CLIENT_ID in Replit secrets.";
    console.error(msg);
    throw new Error("Google Sign-In is not configured for iOS. Please contact support.");
  }

  try {
    await SocialLogin.initialize({ google: googleConfig });
    socialLoginInitialized = true;
    console.log("[AuthInit] initialize success — providers: google");
  } catch (err: any) {
    console.error("[AuthInit] initialize failure — code:", err?.code, "| message:", err?.message, "| full:", JSON.stringify(err));
    throw err;
  }
}

export async function signInWithGoogleUnified(): Promise<UserCredential> {
  if (!isNativeApp()) {
    console.log("[GoogleSignIn] Web path — using signInWithPopup");
    const provider = new GoogleAuthProvider();
    return await signInWithPopup(auth, provider);
  }

  console.log("[GoogleSignIn] Native path — initializing SocialLogin");
  await initSocialLoginIfNeeded();

  console.log("[GoogleSignIn] Calling SocialLogin.login()");
  let res: any;
  try {
    res = await SocialLogin.login({
      provider: "google",
      options: {},
    });
  } catch (loginErr: any) {
    console.error("[GoogleSignIn] SocialLogin.login() threw:", loginErr?.code, loginErr?.message, JSON.stringify(loginErr));
    throw loginErr;
  }

  console.log('[GoogleSignIn] SocialLogin.login() response:', JSON.stringify(res).substring(0, 500));

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
      console.error('[GoogleSignIn] Failed to parse credential:', e);
    }
  }

  if (!idToken && res?.result?.data) {
    try {
      const data = typeof res.result.data === 'string'
        ? JSON.parse(res.result.data)
        : res.result.data;
      idToken = data?.token || data?.idToken;
    } catch (e) {
      console.error('[GoogleSignIn] Failed to parse data:', e);
    }
  }

  if (!idToken) {
    console.error("[GoogleSignIn] No idToken found. Full response:", JSON.stringify(res, null, 2));
    throw new Error("No idToken returned from native Google login. Please try again.");
  }

  console.log('[GoogleSignIn] idToken extracted successfully');
  const credential = GoogleAuthProvider.credential(idToken);
  return await signInWithCredential(auth, credential);
}

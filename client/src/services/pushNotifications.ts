import { Capacitor } from '@capacitor/core';
import { apiRequest } from '@/lib/queryClient';

// Native push token registration (Android + iOS).
//
// Both native apps are Capacitor shells that load this web app from
// https://app.marvelcardvault.com, so this module is what actually asks the
// OS for notification permission and hands the FCM token to the backend.
//
// On iOS this only produces deliverable pushes once the APNs key is uploaded
// to the Firebase project and the Xcode project has the Push Notifications
// capability. Until then registration fails gracefully (registrationError /
// timeout below) and we simply skip — it can never break login.

// Registration is triggered from onAuthStateChanged, which fires on token
// refresh and on appStateChange. These guards keep us from re-POSTing the same
// token on every one of those.
let registering = false;
let lastRegisteredToken: string | null = null;
let tapListenerAttached = false;

async function sendTokenToBackend(token: string): Promise<void> {
  if (token === lastRegisteredToken) return;

  // Relative path on purpose: inside the shell the WebView origin already is
  // https://app.marvelcardvault.com, so this resolves to
  // https://app.marvelcardvault.com/api/push/register-token — while still
  // pointing at localhost during web development instead of hitting prod.
  // apiRequest attaches the existing Firebase bearer/session headers.
  await apiRequest('POST', '/api/push/register-token', {
    token,
    platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
  });

  lastRegisteredToken = token;
  console.log('[Push] FCM token registered');
}

/**
 * Request notification permission and register this device's FCM token.
 *
 * Safe to call on every auth state change. Never throws: a denied permission,
 * an offline device, or a failed request is logged and swallowed so it can
 * never take down login.
 *
 * @returns true if a token was registered with the backend.
 */
export async function registerPushNotifications(): Promise<boolean> {
  // Only run inside the native shells (Android or iOS); plain web -> skip.
  const platform = Capacitor.getPlatform();
  if (!Capacitor.isNativePlatform() || (platform !== 'android' && platform !== 'ios')) {
    return false;
  }
  if (registering) return false;
  registering = true;

  try {
    // Dynamic import so the browser bundle never pulls in the native plugin.
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Route notification taps: if the payload carries an in-app url
    // (e.g. /social?tab=messages&user=123), navigate there.
    if (!tapListenerAttached) {
      tapListenerAttached = true;
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action.notification?.data?.url;
        if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return;
        try {
          // Same-origin check guards against any crafted payload redirecting off-site.
          const resolved = new URL(url, window.location.origin);
          if (resolved.origin === window.location.origin) {
            window.location.assign(resolved.pathname + resolved.search);
          }
        } catch {
          // Malformed url — ignore.
        }
      });
    }

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }

    // User said no (or the OS blocked it). Nothing more to do — not an error.
    if (status.receive !== 'granted') {
      console.log('[Push] notification permission not granted; skipping');
      return false;
    }

    // Listeners must be attached before register() so we don't miss the token.
    const token = await new Promise<string | null>((resolve) => {
      // If FCM never calls back (no Play Services, no network), resolve rather
      // than leaving this promise — and the `registering` flag — stuck forever.
      const timeout = setTimeout(() => resolve(null), 15000);

      PushNotifications.addListener('registration', (t) => {
        clearTimeout(timeout);
        resolve(t.value);
      });

      PushNotifications.addListener('registrationError', (err) => {
        clearTimeout(timeout);
        console.warn('[Push] FCM registration failed:', err);
        resolve(null);
      });

      PushNotifications.register();
    });

    if (!token) {
      console.warn('[Push] no FCM token returned; skipping registration');
      return false;
    }

    await sendTokenToBackend(token);
    return true;
  } catch (error) {
    // Includes the 401 apiRequest throws if the session isn't valid yet.
    console.warn('[Push] token registration skipped:', error);
    return false;
  } finally {
    registering = false;
  }
}

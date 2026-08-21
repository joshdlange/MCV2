import type { User } from "firebase/auth";

export interface BackendUser {
  id: number;
  username: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  isAdmin: boolean;
  plan: string;
  subscriptionStatus: string;
  onboardingComplete: boolean;
}

export class BackendUserSyncError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "BackendUserSyncError";
  }
}

interface SyncOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
  maxAttempts?: number;
  maxStartupAttempts?: number;
  maxTransportAttempts?: number;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function isTransientFirebaseTokenError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return [
    "auth/network-request-failed",
    "auth/timeout",
    "auth/internal-error",
  ].includes(code);
}

export async function syncFirebaseUserWithBackend(
  firebaseUser: User,
  options: SyncOptions = {},
): Promise<BackendUser> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((delayMs: number) =>
    new Promise(resolve => setTimeout(resolve, delayMs)));
  const maxAttempts = options.maxAttempts ?? 3;
  const maxStartupAttempts = options.maxStartupAttempts ?? Number.POSITIVE_INFINITY;
  const maxTransportAttempts = options.maxTransportAttempts ?? Number.POSITIVE_INFINITY;
  let retryableAttempts = 0;
  let startupAttempts = 0;
  let transportAttempts = 0;

  while (true) {
    // Firebase caches valid tokens and refreshes expiring ones, so a long
    // deployment wait cannot strand the eventual sync with an expired token.
    let token: string;
    try {
      token = await firebaseUser.getIdToken();
    } catch (error) {
      if (!isTransientFirebaseTokenError(error)) throw error;
      transportAttempts += 1;
      if (transportAttempts >= maxTransportAttempts) throw error;
      await sleepImpl(Math.min(1000 * (2 ** Math.min(transportAttempts - 1, 5)), 30000));
      continue;
    }

    let response: Response;
    try {
      response = await fetchImpl("/api/auth/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          refShareToken: (() => {
            try {
              return localStorage.getItem("mcv_ref_share_token") || undefined;
            } catch {
              return undefined;
            }
          })(),
        }),
      });
    } catch (error) {
      // fetch rejects only when the request could not complete (for example,
      // the old deployment instance closed while the new one was starting).
      transportAttempts += 1;
      if (transportAttempts >= maxTransportAttempts) throw error;
      await sleepImpl(Math.min(1000 * (2 ** Math.min(transportAttempts - 1, 5)), 30000));
      continue;
    }
    transportAttempts = 0;

    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.user?.id) {
      return data.user as BackendUser;
    }

    const error = new BackendUserSyncError(
      data?.message || "Failed to finish account setup",
      response.status,
      data?.code,
    );

    // A publish in progress is not an account error. Keep the app's automatic
    // loading gate up until readiness rather than ever asking the user to
    // click Retry or reload.
    if (response.status === 503 && data?.code === "APP_STARTING") {
      startupAttempts += 1;
      if (startupAttempts >= maxStartupAttempts) throw error;
      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      await sleepImpl(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 2000);
      continue;
    }

    retryableAttempts += 1;
    if (!RETRYABLE_STATUSES.has(response.status) || retryableAttempts >= maxAttempts) {
      throw error;
    }

    await sleepImpl(Math.min(1000 * retryableAttempts, 3000));
  }
}
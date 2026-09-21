import type { User } from "firebase/auth";

export interface BackendUser {
  id: number;
  username: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  isAdmin: boolean;
  imageAdmin: boolean;
  plan: string;
  subscriptionStatus: string;
  onboardingComplete: boolean;
  totalLogins: number;
}

export class BackendUserSyncError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "BackendUserSyncError";
  }
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
  randomImpl?: () => number;
  nowImpl?: () => number;
  signal?: AbortSignal;
  onRetry?: (error: BackendUserSyncError, delayMs: number) => void;
  // Primarily useful to bound isolated callers/tests. Auth sync leaves this
  // unset and retries until its AbortSignal is cancelled.
  maxRetryDurationMs?: number;
  maxRetryDelayMs?: number;
  maxAttempts?: number;
  maxStartupAttempts?: number;
  maxTransportAttempts?: number;
  nativeLogin?: {
    sessionId: string;
    platform: "android" | "ios";
  };
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE";
const INDEFINITE_HTTP_RETRY_CODES = new Set([
  DATABASE_UNAVAILABLE,
  "AUTH_PROVIDER_UNAVAILABLE",
  "APP_STARTING",
]);

export const CONNECTION_UNAVAILABLE_COPY = {
  title: "We can't connect to the Vault right now",
  body: "Your sign-in is safe. We're having trouble reaching the Vault and will keep trying automatically.",
  retry: "Try again now",
} as const;

export function isRetryableSyncError(error: unknown): boolean {
  if (error instanceof BackendUserSyncError) return error.retryable;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  return isTransientFirebaseTokenError(error);
}

function abortError(): DOMException {
  return new DOMException("Account sync cancelled", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function sleep(
  delayMs: number,
  sleepImpl: (delayMs: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await sleepImpl(delayMs);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    sleepImpl(delayMs).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
  throwIfAborted(signal);
}

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
  const randomImpl = options.randomImpl ?? Math.random;
  const nowImpl = options.nowImpl ?? Date.now;
  const maxAttempts = options.maxAttempts ?? 3;
  const maxStartupAttempts = options.maxStartupAttempts ?? Number.POSITIVE_INFINITY;
  const maxTransportAttempts = options.maxTransportAttempts ?? Number.POSITIVE_INFINITY;
  let retryableAttempts = 0;
  let startupAttempts = 0;
  let transportAttempts = 0;
  const retryStartedAt = nowImpl();
  const maxRetryDurationMs = options.maxRetryDurationMs ?? Number.POSITIVE_INFINITY;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;

  const retryDelay = async (attempt: number, error: BackendUserSyncError) => {
    const remainingMs = maxRetryDurationMs - (nowImpl() - retryStartedAt);
    if (remainingMs <= 0) throw error;
    const exponential = Math.min(1000 * (2 ** Math.min(attempt - 1, 5)), maxRetryDelayMs);
    const jittered = Math.round(exponential * (0.75 + randomImpl() * 0.5));
    const delay = Math.max(0, Math.min(jittered, maxRetryDelayMs, remainingMs));
    options.onRetry?.(error, delay);
    await sleep(delay, sleepImpl, options.signal);
  };

  while (true) {
    throwIfAborted(options.signal);
    // Firebase caches valid tokens and refreshes expiring ones, so a long
    // deployment wait cannot strand the eventual sync with an expired token.
    let token: string;
    try {
      token = await firebaseUser.getIdToken();
    } catch (error) {
      if (!isTransientFirebaseTokenError(error)) throw error;
      transportAttempts += 1;
      if (transportAttempts >= maxTransportAttempts) throw error;
      const retryError = new BackendUserSyncError(
        "Unable to reach the Vault",
        0,
        "NETWORK_UNAVAILABLE",
        true,
      );
      await retryDelay(transportAttempts, retryError);
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
        signal: options.signal,
        body: JSON.stringify({
          refShareToken: (() => {
            try {
              return localStorage.getItem("mcv_ref_share_token") || undefined;
            } catch {
              return undefined;
            }
          })(),
          nativeLogin: options.nativeLogin,
        }),
      });
    } catch (error) {
      // fetch rejects only when the request could not complete (for example,
      // the old deployment instance closed while the new one was starting).
      transportAttempts += 1;
      if (transportAttempts >= maxTransportAttempts) throw error;
      const retryError = new BackendUserSyncError(
        "Unable to reach the Vault",
        0,
        "NETWORK_UNAVAILABLE",
        true,
      );
      await retryDelay(transportAttempts, retryError);
      continue;
    }
    transportAttempts = 0;

    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.user?.id) {
      return data.user as BackendUser;
    }

    // An explicit false always wins. This lets the server surface permanent
    // provider/configuration failures even when they use a 5xx status.
    const retryable = data?.retryable === false
      ? false
      : data?.retryable === true || RETRYABLE_STATUSES.has(response.status);
    const error = new BackendUserSyncError(
      data?.message || "Failed to finish account setup",
      response.status,
      data?.code,
      retryable,
    );

    // A publish in progress is not an account error. Keep retrying while the
    // auth gate presents the temporary connection state.
    if (
      response.status === 503 &&
      data?.code === "APP_STARTING" &&
      data?.retryable !== false
    ) {
      startupAttempts += 1;
      if (startupAttempts >= maxStartupAttempts) throw error;
      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, maxRetryDelayMs)
        : undefined;
      const remainingMs = maxRetryDurationMs - (nowImpl() - retryStartedAt);
      if (remainingMs <= 0) throw error;
      const boundedDelay = Math.min(delay ?? 2000, remainingMs);
      options.onRetry?.(error, boundedDelay);
      await sleep(boundedDelay, sleepImpl, options.signal);
      continue;
    }

    // Explicit database/auth-provider outage codes are operational states, not
    // failures to create this collector's account.
    if (
      RETRYABLE_STATUSES.has(response.status) &&
      INDEFINITE_HTTP_RETRY_CODES.has(data?.code) &&
      data?.code !== "APP_STARTING" &&
      data?.retryable !== false
    ) {
      retryableAttempts += 1;
      await retryDelay(retryableAttempts, error);
      continue;
    }

    retryableAttempts += 1;
    if (!retryable || retryableAttempts >= maxAttempts) {
      if (retryable && retryableAttempts >= maxAttempts) {
        throw new BackendUserSyncError(
          error.message,
          error.status,
          error.code,
          false,
        );
      }
      throw error;
    }

    await retryDelay(retryableAttempts, error);
  }
}
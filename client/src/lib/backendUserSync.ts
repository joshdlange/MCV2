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
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function syncFirebaseUserWithBackend(
  firebaseUser: User,
  options: SyncOptions = {},
): Promise<BackendUser> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((delayMs: number) =>
    new Promise(resolve => setTimeout(resolve, delayMs)));
  const maxAttempts = options.maxAttempts ?? 3;
  const token = await firebaseUser.getIdToken();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl("/api/auth/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        firebaseUid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        refShareToken: (() => {
          try {
            return localStorage.getItem("mcv_ref_share_token") || undefined;
          } catch {
            return undefined;
          }
        })(),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.user?.id) {
      return data.user as BackendUser;
    }

    const error = new BackendUserSyncError(
      data?.message || "Failed to finish account setup",
      response.status,
      data?.code,
    );
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
      throw error;
    }

    await sleepImpl(500 * attempt);
  }

  throw new BackendUserSyncError("Failed to finish account setup", 500);
}
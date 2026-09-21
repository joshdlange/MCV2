import type { Auth, DecodedIdToken } from "firebase-admin/auth";

export class FirebaseSyncAuthError extends Error {
  readonly status = 401;
  readonly code = "INVALID_FIREBASE_TOKEN";

  constructor(message = "Valid Firebase authentication is required") {
    super(message);
    this.name = "FirebaseSyncAuthError";
  }
}

export class FirebaseDirectoryUnavailableError extends Error {
  readonly status = 503;
  readonly code = "AUTH_PROVIDER_UNAVAILABLE";
  readonly retryable = true;

  constructor() {
    super("Authentication provider temporarily unavailable");
    this.name = "FirebaseDirectoryUnavailableError";
  }
}

export class FirebaseDirectoryIdentityError extends Error {
  readonly retryable = false;

  constructor(
    readonly status: 400 | 404 | 422,
    readonly code:
      | "INVALID_FIREBASE_IDENTITY"
      | "FIREBASE_USER_NOT_FOUND"
      | "FIREBASE_IDENTITY_LOOKUP_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "FirebaseDirectoryIdentityError";
  }
}

type FirebaseAdminErrorLike = {
  code?: unknown;
  errorInfo?: {
    code?: unknown;
  };
  cause?: unknown;
};

const TRANSIENT_FIREBASE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "app/network-error",
  "auth/internal-error",
  "auth/quota-exceeded",
  "auth/service-unavailable",
  "auth/too-many-requests",
]);

function firebaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return undefined;
    const candidate = current as FirebaseAdminErrorLike;
    const code =
      typeof candidate.errorInfo?.code === "string"
        ? candidate.errorInfo.code
        : typeof candidate.code === "string"
          ? candidate.code
          : undefined;
    if (code) return code;
    current = candidate.cause;
  }
  return undefined;
}

function mapFirebaseDirectoryError(error: unknown): Error {
  const code = firebaseErrorCode(error);
  if (code && TRANSIENT_FIREBASE_ERROR_CODES.has(code)) {
    return new FirebaseDirectoryUnavailableError();
  }
  if (code === "auth/user-not-found") {
    return new FirebaseDirectoryIdentityError(
      404,
      "FIREBASE_USER_NOT_FOUND",
      "Verified Firebase user no longer exists",
    );
  }
  if (code === "auth/invalid-uid" || code === "auth/invalid-argument") {
    return new FirebaseDirectoryIdentityError(
      400,
      "INVALID_FIREBASE_IDENTITY",
      "Firebase identity is invalid",
    );
  }
  return new FirebaseDirectoryIdentityError(
    422,
    "FIREBASE_IDENTITY_LOOKUP_FAILED",
    "Firebase identity could not be loaded",
  );
}

export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

type FirebaseTokenVerifier = Pick<Auth, "verifyIdToken">;
type FirebaseUserReader = Pick<Auth, "getUser">;

export async function verifyFirebaseSyncIdentity(
  auth: FirebaseTokenVerifier,
  authorizationHeader: string | undefined,
): Promise<VerifiedFirebaseIdentity> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new FirebaseSyncAuthError();
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) throw new FirebaseSyncAuthError();

  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    throw new FirebaseSyncAuthError();
  }

  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
    photoURL: decoded.picture ?? null,
  };
}

/**
 * Reads the canonical Firebase profile only when a verified UID has no
 * database row and must be created. Existing-user sync stays local after token
 * verification rather than making a Firebase Admin network call on every app
 * foreground.
 */
export async function loadCanonicalFirebaseIdentity(
  auth: FirebaseUserReader,
  verifiedIdentity: VerifiedFirebaseIdentity,
): Promise<VerifiedFirebaseIdentity> {
  let record;
  try {
    record = await auth.getUser(verifiedIdentity.uid);
  } catch (error) {
    // Keep Firebase transport failures distinct from similarly-coded database
    // network failures so auth sync never reports the wrong dependency.
    throw mapFirebaseDirectoryError(error);
  }
  return {
    uid: verifiedIdentity.uid,
    email: record.email ?? verifiedIdentity.email,
    displayName: record.displayName ?? verifiedIdentity.displayName,
    photoURL: record.photoURL ?? verifiedIdentity.photoURL,
  };
}
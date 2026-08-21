import type { Auth, DecodedIdToken } from "firebase-admin/auth";

export class FirebaseSyncAuthError extends Error {
  readonly status = 401;
  readonly code = "INVALID_FIREBASE_TOKEN";

  constructor(message = "Valid Firebase authentication is required") {
    super(message);
    this.name = "FirebaseSyncAuthError";
  }
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
  const record = await auth.getUser(verifiedIdentity.uid);
  return {
    uid: verifiedIdentity.uid,
    email: record.email ?? verifiedIdentity.email,
    displayName: record.displayName ?? verifiedIdentity.displayName,
    photoURL: record.photoURL ?? verifiedIdentity.photoURL,
  };
}
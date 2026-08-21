import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";

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

type FirebaseAuthVerifier = Pick<Auth, "verifyIdToken" | "getUser">;

export async function verifyFirebaseSyncIdentity(
  auth: FirebaseAuthVerifier,
  authorizationHeader: string | undefined,
): Promise<VerifiedFirebaseIdentity> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new FirebaseSyncAuthError();
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) throw new FirebaseSyncAuthError();

  let decoded: DecodedIdToken;
  let record: UserRecord;
  try {
    decoded = await auth.verifyIdToken(token);
    record = await auth.getUser(decoded.uid);
  } catch {
    throw new FirebaseSyncAuthError();
  }

  return {
    uid: decoded.uid,
    email: record.email ?? decoded.email ?? null,
    displayName: record.displayName ?? decoded.name ?? null,
    photoURL: record.photoURL ?? decoded.picture ?? null,
  };
}
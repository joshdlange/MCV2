import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FirebaseDirectoryIdentityError,
  FirebaseDirectoryUnavailableError,
  FirebaseSyncAuthError,
  loadCanonicalFirebaseIdentity,
  verifyFirebaseSyncIdentity,
} from "../services/verifiedFirebaseIdentity";

test("existing-user sync identity comes from the verified token without a profile lookup", async () => {
  const auth = {
    verifyIdToken: async (token: string) => {
      assert.equal(token, "valid-token");
      return {
        uid: "verified-uid",
        email: "token@example.test",
        name: "Token Name",
        picture: "https://example.test/token-avatar.png",
      };
    },
  } as any;

  const identity = await verifyFirebaseSyncIdentity(auth, "Bearer valid-token");
  assert.deepEqual(identity, {
    uid: "verified-uid",
    email: "token@example.test",
    displayName: "Token Name",
    photoURL: "https://example.test/token-avatar.png",
  });
});

test("missing-user creation upgrades verified claims with the canonical Firebase profile", async () => {
  const identity = await loadCanonicalFirebaseIdentity({
    getUser: async (uid: string) => {
      assert.equal(uid, "verified-uid");
      return {
        uid,
        email: "canonical@example.test",
        displayName: "canonical_user",
        photoURL: "https://example.test/avatar.png",
      };
    },
  } as any, {
    uid: "verified-uid",
    email: "token@example.test",
    displayName: "Token Name",
    photoURL: null,
  });

  assert.deepEqual(identity, {
    uid: "verified-uid",
    email: "canonical@example.test",
    displayName: "canonical_user",
    photoURL: "https://example.test/avatar.png",
  });
});

test("sync rejects missing and invalid bearer tokens", async () => {
  const auth = {
    verifyIdToken: async () => {
      throw new Error("invalid");
    },
  } as any;

  await assert.rejects(
    verifyFirebaseSyncIdentity(auth, undefined),
    (error: unknown) => error instanceof FirebaseSyncAuthError && error.status === 401,
  );
  await assert.rejects(
    verifyFirebaseSyncIdentity(auth, "Bearer forged"),
    (error: unknown) => error instanceof FirebaseSyncAuthError && error.status === 401,
  );
});

test("transient Firebase directory failures are retryable provider outages", async () => {
  await assert.rejects(
    loadCanonicalFirebaseIdentity({
      getUser: async () => {
        throw Object.assign(new Error("network timeout"), { code: "ETIMEDOUT" });
      },
    } as any, {
      uid: "verified-uid",
      email: null,
      displayName: null,
      photoURL: null,
    }),
    (error: unknown) =>
      error instanceof FirebaseDirectoryUnavailableError &&
      error.code === "AUTH_PROVIDER_UNAVAILABLE",
  );
});

test("missing and invalid Firebase identities are explicit non-retryable 4xx errors", async () => {
  for (const scenario of [
    {
      firebaseCode: "auth/user-not-found",
      status: 404,
      responseCode: "FIREBASE_USER_NOT_FOUND",
    },
    {
      firebaseCode: "auth/invalid-uid",
      status: 400,
      responseCode: "INVALID_FIREBASE_IDENTITY",
    },
  ]) {
    await assert.rejects(
      loadCanonicalFirebaseIdentity({
        getUser: async () => {
          throw { errorInfo: { code: scenario.firebaseCode } };
        },
      } as any, {
        uid: "verified-uid",
        email: null,
        displayName: null,
        photoURL: null,
      }),
      (error: unknown) =>
        error instanceof FirebaseDirectoryIdentityError &&
        error.status === scenario.status &&
        error.code === scenario.responseCode &&
        error.retryable === false,
    );
  }
});

test("unknown Firebase directory failures are explicitly non-retryable", async () => {
  await assert.rejects(
    loadCanonicalFirebaseIdentity({
      getUser: async () => {
        throw new Error("unexpected SDK failure");
      },
    } as any, {
      uid: "verified-uid",
      email: null,
      displayName: null,
      photoURL: null,
    }),
    (error: unknown) =>
      error instanceof FirebaseDirectoryIdentityError &&
      error.status === 422 &&
      error.code === "FIREBASE_IDENTITY_LOOKUP_FAILED" &&
      error.retryable === false,
  );
});
import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
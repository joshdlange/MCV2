import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FirebaseSyncAuthError,
  verifyFirebaseSyncIdentity,
} from "../services/verifiedFirebaseIdentity";

test("sync identity comes only from the verified Firebase account", async () => {
  const auth = {
    verifyIdToken: async (token: string) => {
      assert.equal(token, "valid-token");
      return {
        uid: "verified-uid",
        email: "token@example.test",
        name: "Token Name",
      };
    },
    getUser: async (uid: string) => {
      assert.equal(uid, "verified-uid");
      return {
        uid,
        email: "canonical@example.test",
        displayName: "canonical_user",
        photoURL: "https://example.test/avatar.png",
      };
    },
  } as any;

  const identity = await verifyFirebaseSyncIdentity(auth, "Bearer valid-token");
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
    getUser: async () => {
      throw new Error("must not matter");
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
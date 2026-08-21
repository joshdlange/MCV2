import { test } from "node:test";
import assert from "node:assert/strict";
import type { User } from "firebase/auth";
import {
  BackendUserSyncError,
  syncFirebaseUserWithBackend,
} from "./backendUserSync";

const firebaseUser = {
  uid: "firebase-user-1",
  email: "collector@example.test",
  displayName: "Collector",
  photoURL: null,
  getIdToken: async () => "test-token",
} as unknown as User;

test("backend sync retries a temporary startup response and returns the user", async () => {
  let calls = 0;
  const user = await syncFirebaseUserWithBackend(firebaseUser, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          message: "The Vault is updating",
          code: "APP_STARTING",
        }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        user: {
          id: 42,
          username: "collector",
          email: "collector@example.test",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    sleepImpl: async () => {},
  });

  assert.equal(calls, 2);
  assert.equal(user.id, 42);
});

test("backend sync rejects instead of admitting a Firebase-only user", async () => {
  await assert.rejects(
    syncFirebaseUserWithBackend(firebaseUser, {
      fetchImpl: async () => new Response(JSON.stringify({
        message: "Failed to sync user",
      }), { status: 500, headers: { "Content-Type": "application/json" } }),
      sleepImpl: async () => {},
      maxAttempts: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof BackendUserSyncError);
      assert.equal(error.status, 500);
      return true;
    },
  );
});
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

test("startup responses keep retrying beyond the ordinary error retry limit", async () => {
  let calls = 0;
  const user = await syncFirebaseUserWithBackend(firebaseUser, {
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 5) {
        return new Response(JSON.stringify({
          message: "The Vault is updating",
          code: "APP_STARTING",
        }), {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "2",
          },
        });
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
    maxAttempts: 1,
  });

  assert.equal(calls, 6);
  assert.equal(user.id, 42);
});

test("deployment transport and Firebase network failures retry automatically", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const temporarilyOfflineUser = {
    ...firebaseUser,
    getIdToken: async () => {
      tokenCalls += 1;
      if (tokenCalls === 1) {
        throw Object.assign(new Error("offline"), {
          code: "auth/network-request-failed",
        });
      }
      return "test-token";
    },
  } as unknown as User;

  const user = await syncFirebaseUserWithBackend(temporarilyOfflineUser, {
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({
        user: {
          id: 42,
          username: "collector",
          email: "collector@example.test",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    sleepImpl: async () => {},
    maxAttempts: 1,
  });

  assert.equal(tokenCalls, 3);
  assert.equal(fetchCalls, 2);
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
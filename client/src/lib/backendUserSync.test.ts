import { test } from "node:test";
import assert from "node:assert/strict";
import type { User } from "firebase/auth";
import {
  BackendUserSyncError,
  CONNECTION_UNAVAILABLE_COPY,
  syncFirebaseUserWithBackend,
} from "./backendUserSync";
import { getNativeLaunchSession } from "./nativeLaunchSession";

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

test("unclassified retryable HTTP failures stop after the finite default budget", async () => {
  let calls = 0;
  await assert.rejects(
    syncFirebaseUserWithBackend(firebaseUser, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          message: "Unexpected provider failure",
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
      sleepImpl: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof BackendUserSyncError);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("retryable false prevents retries even for a 503", async () => {
  let calls = 0;
  await assert.rejects(
    syncFirebaseUserWithBackend(firebaseUser, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          message: "Provider configuration is invalid",
          code: "AUTH_PROVIDER_CONFIGURATION_ERROR",
          retryable: false,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      },
      sleepImpl: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof BackendUserSyncError);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("explicit auth provider outage retries beyond the generic budget", async () => {
  let calls = 0;
  const user = await syncFirebaseUserWithBackend(firebaseUser, {
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 5) {
        return new Response(JSON.stringify({
          code: "AUTH_PROVIDER_UNAVAILABLE",
          retryable: true,
        }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
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
    randomImpl: () => 0.5,
  });

  assert.equal(calls, 6);
  assert.equal(user.id, 42);
});

test("database outage retries repeatedly with bounded exponential jitter, then succeeds", async () => {
  let calls = 0;
  const delays: number[] = [];
  const user = await syncFirebaseUserWithBackend(firebaseUser, {
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 4) {
        return new Response(JSON.stringify({
          message: "Database is temporarily unavailable",
          code: "DATABASE_UNAVAILABLE",
          retryable: true,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
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
    sleepImpl: async delay => { delays.push(delay); },
    randomImpl: () => 0.5,
    maxRetryDelayMs: 2500,
    maxAttempts: 1,
  });

  assert.equal(calls, 5);
  assert.equal(user.id, 42);
  assert.deepEqual(delays, [1000, 2000, 2500, 2500]);
});

test("database outage recovers beyond two minutes while retry delay stays capped", async () => {
  let now = 0;
  let calls = 0;
  const delays: number[] = [];
  const user = await syncFirebaseUserWithBackend(firebaseUser, {
    fetchImpl: async () => {
      calls += 1;
      if (now < 172 * 60 * 1000) {
        return new Response(JSON.stringify({
          code: "DATABASE_UNAVAILABLE",
          retryable: true,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
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
    nowImpl: () => now,
    randomImpl: () => 0.5,
    sleepImpl: async delay => {
      delays.push(delay);
      now += delay;
    },
  });

  assert.equal(user.id, 42);
  assert.ok(now >= 172 * 60 * 1000);
  assert.ok(calls > 300);
  assert.equal(Math.max(...delays), 30_000);
  assert.ok(delays.every(delay => delay <= 30_000));
});

test("abort on logout or unmount cancels a pending outage retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = syncFirebaseUserWithBackend(firebaseUser, {
    signal: controller.signal,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        code: "DATABASE_UNAVAILABLE",
        retryable: true,
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    },
    sleepImpl: () => new Promise(() => {}),
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, error =>
    error instanceof DOMException && error.name === "AbortError");
  assert.equal(calls, 1);
});

test("permanent identity errors do not retry", async () => {
  let calls = 0;
  await assert.rejects(
    syncFirebaseUserWithBackend(firebaseUser, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          message: "This sign-in identity is not valid",
          code: "INVALID_IDENTITY",
          retryable: false,
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      },
      sleepImpl: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof BackendUserSyncError);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("temporary outage copy does not describe an account setup failure", () => {
  assert.equal(CONNECTION_UNAVAILABLE_COPY.title, "We can't connect to the Vault right now");
  assert.match(CONNECTION_UNAVAILABLE_COPY.body, /sign-in is safe/i);
  assert.doesNotMatch(
    `${CONNECTION_UNAVAILABLE_COPY.title} ${CONNECTION_UNAVAILABLE_COPY.body}`,
    /finish setting up|account is not ready/i,
  );
});

test("native login metadata is sent only when the caller supplies a native launch", async () => {
  let requestBody: any;
  await syncFirebaseUserWithBackend(firebaseUser, {
    nativeLogin: {
      sessionId: "native-session-123",
      platform: "android",
    },
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        user: {
          id: 42,
          username: "collector",
          email: "collector@example.test",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.deepEqual(requestBody.nativeLogin, {
    sessionId: "native-session-123",
    platform: "android",
  });
});

test("app-level auth retries reuse one native cold-launch session", () => {
  const first = getNativeLaunchSession("android");
  const retry = getNativeLaunchSession("android");

  assert.ok(first);
  assert.strictEqual(retry, first);
  assert.equal(retry?.sessionId, first.sessionId);
});
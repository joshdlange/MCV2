import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATABASE_UNAVAILABLE_RESPONSE,
  AuthDatabaseAvailabilityTracker,
  hashInternalIdentity,
  isDatabaseUnavailableError,
} from "../services/authDatabaseAvailability";
import { resolveFirebaseUserForSync } from "../services/firebaseUserSync";

test("failed auth lookup is an outage and never becomes user creation", async () => {
  const outage = Object.assign(new Error("endpoint has been disabled"), { code: "28000" });
  let identityLoads = 0;
  let writes = 0;

  await assert.rejects(
    resolveFirebaseUserForSync(
      "firebase-internal-uid",
      async () => {
        identityLoads += 1;
        return {} as any;
      },
      {
        lookup: async () => {
          throw outage;
        },
        create: async () => {
          writes += 1;
          throw new Error("must not write");
        },
      },
    ),
    error => error === outage,
  );

  assert.equal(identityLoads, 0);
  assert.equal(writes, 0);
  assert.equal(isDatabaseUnavailableError(outage), true);
  assert.deepEqual(DATABASE_UNAVAILABLE_RESPONSE, {
    message: "Database temporarily unavailable. Please retry.",
    code: "DATABASE_UNAVAILABLE",
    retryable: true,
  });
});

test("auth database failure and recovery logs are structured and identity-safe", () => {
  const records: Record<string, unknown>[] = [];
  const tracker = new AuthDatabaseAvailabilityTracker(record => records.push(record));
  const uid = "private-firebase-uid";

  tracker.failure("request-1", uid, Object.assign(new Error("disabled"), { code: "28000" }));
  tracker.recovery("request-2", uid);
  tracker.recovery("request-3", uid);

  assert.deepEqual(records, [
    {
      event: "auth_sync_database_unavailable",
      requestId: "request-1",
      identityHash: hashInternalIdentity(uid),
      databaseErrorCode: "28000",
    },
    {
      event: "auth_sync_database_recovered",
      requestId: "request-2",
      identityHash: hashInternalIdentity(uid),
    },
  ]);
  assert.equal(JSON.stringify(records).includes(uid), false);
  assert.equal(JSON.stringify(records).includes("token"), false);
  assert.equal(JSON.stringify(records).includes("@"), false);
});
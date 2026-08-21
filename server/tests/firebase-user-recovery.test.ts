import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planSafeFirebaseAccountRecovery,
  type FirebaseIdentity,
} from "../services/firebaseUserRecovery";

test("only missing-UID identities without an existing email are safe to recover", () => {
  const firebaseUsers: FirebaseIdentity[] = [
    { uid: "already-linked", email: "linked@example.test", displayName: "Linked", photoURL: null },
    { uid: "safe-recovery", email: "fresh@example.test", displayName: "Fresh", photoURL: null },
    { uid: "email-conflict", email: "owner@example.test", displayName: "Owner", photoURL: null },
    { uid: "missing-email", email: null, displayName: "Apple User", photoURL: null },
  ];
  const plan = planSafeFirebaseAccountRecovery(firebaseUsers, [
    { firebaseUid: "already-linked", email: "linked@example.test" },
    { firebaseUid: "different-uid", email: "OWNER@example.test" },
  ]);

  assert.deepEqual(plan.candidates.map(user => user.uid), ["safe-recovery"]);
  assert.equal(plan.alreadyLinked, 1);
  assert.equal(plan.skippedEmailConflict, 1);
  assert.equal(plan.skippedMissingEmail, 1);
});
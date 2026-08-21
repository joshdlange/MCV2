import { after, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { recoverSafeFirebaseOnlyAccounts } from "../services/firebaseUserRecovery";

const RECOVERY_MARKER = "firebase_only_account_recovery_v1";

after(async () => {
  await db.execute(sql`DELETE FROM startup_migrations WHERE name = ${RECOVERY_MARKER}`);
  await pool.end();
});

test("completed recovery skips Firebase and full-database scans", async () => {
  await db.execute(sql`
    INSERT INTO startup_migrations (name)
    VALUES (${RECOVERY_MARKER})
    ON CONFLICT (name) DO NOTHING
  `);

  // Firebase Admin is deliberately not initialized in this test. Reaching it
  // would fail, proving the durable marker did not short-circuit recovery.
  const report = await recoverSafeFirebaseOnlyAccounts();

  assert.equal(report.alreadyCompleted, true);
  assert.equal(report.scanned, 0);
  assert.equal(report.created, 0);
  assert.equal(report.failed, 0);
});
import admin from "firebase-admin";
import { pool, db } from "../db";
import { users } from "../../shared/schema";
import { createOrGetFirebaseUser, getInitialUsernameSeed } from "./firebaseUserSync";

export interface FirebaseIdentity {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface DatabaseIdentity {
  firebaseUid: string;
  email: string;
}

export interface FirebaseRecoveryPlan {
  candidates: FirebaseIdentity[];
  alreadyLinked: number;
  skippedEmailConflict: number;
  skippedMissingEmail: number;
}

export interface FirebaseRecoveryReport extends Omit<FirebaseRecoveryPlan, "candidates"> {
  scanned: number;
  created: number;
  converged: number;
  failed: number;
  alreadyCompleted: boolean;
}

const RECOVERY_MARKER = "firebase_only_account_recovery_v1";
const LOCK_TIMEOUT_MS = 30_000;
const EXTERNAL_OPERATION_TIMEOUT_MS = 30_000;
const ACCOUNT_CREATE_TIMEOUT_MS = 15_000;

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

/**
 * Selects only identities that are safe to create as new production users.
 * Existing-email identities are intentionally excluded: they need account
 * reconciliation, not an automatic duplicate row.
 */
export function planSafeFirebaseAccountRecovery(
  firebaseUsers: FirebaseIdentity[],
  databaseUsers: DatabaseIdentity[],
): FirebaseRecoveryPlan {
  const databaseUids = new Set(databaseUsers.map(user => user.firebaseUid));
  const databaseEmails = new Set(databaseUsers.map(user => normalizedEmail(user.email)));
  const plan: FirebaseRecoveryPlan = {
    candidates: [],
    alreadyLinked: 0,
    skippedEmailConflict: 0,
    skippedMissingEmail: 0,
  };

  for (const firebaseUser of firebaseUsers) {
    if (databaseUids.has(firebaseUser.uid)) {
      plan.alreadyLinked += 1;
      continue;
    }
    if (!firebaseUser.email) {
      plan.skippedMissingEmail += 1;
      continue;
    }
    if (databaseEmails.has(normalizedEmail(firebaseUser.email))) {
      plan.skippedEmailConflict += 1;
      continue;
    }
    plan.candidates.push(firebaseUser);
  }

  return plan;
}

async function listFirebaseUsers(): Promise<FirebaseIdentity[]> {
  if (!admin.apps.length) {
    throw new Error("Firebase Admin is not initialized");
  }

  const firebaseUsers: FirebaseIdentity[] = [];
  let pageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    firebaseUsers.push(...page.users.map(user => ({
      uid: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
    })));
    pageToken = page.pageToken;
  } while (pageToken);

  return firebaseUsers;
}

/**
 * Deployment-time recovery for Firebase identities that never received a
 * database row. The session-level advisory lock makes this safe on autoscale
 * instances, while createOrGetFirebaseUser keeps each write race-safe.
 */
export async function recoverSafeFirebaseOnlyAccounts(): Promise<FirebaseRecoveryReport> {
  const lockClient = await pool.connect();
  let locked = false;
  try {
    // A stalled peer deployment must not keep a replacement instance in the
    // update gate forever. Retrying at the startup level is safer than serving
    // a partially recovered app.
    await lockClient.query(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await lockClient.query(
      "SELECT pg_advisory_lock(hashtext($1))",
      ["firebase_only_account_recovery_v1"],
    );
    locked = true;

    // This marker is production-database scoped and is read while holding the
    // same lock as recovery. Once the first safe pass completes, all future
    // rolling-deployment instances take this O(1) path instead of repeatedly
    // paging the whole Firebase directory.
    const completed = await lockClient.query<{ complete: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM startup_migrations WHERE name = $1) AS complete",
      [RECOVERY_MARKER],
    );
    if (completed.rows[0]?.complete) {
      return {
        scanned: 0,
        created: 0,
        converged: 0,
        failed: 0,
        alreadyLinked: 0,
        skippedEmailConflict: 0,
        skippedMissingEmail: 0,
        alreadyCompleted: true,
      };
    }

    const [firebaseUsers, databaseUsers] = await Promise.all([
      withTimeout(listFirebaseUsers(), EXTERNAL_OPERATION_TIMEOUT_MS, "Firebase account listing"),
      withTimeout(
        db.select({ firebaseUid: users.firebaseUid, email: users.email }).from(users),
        EXTERNAL_OPERATION_TIMEOUT_MS,
        "Database identity listing",
      ),
    ]);
    const plan = planSafeFirebaseAccountRecovery(firebaseUsers, databaseUsers);
    let created = 0;
    let converged = 0;
    let failed = 0;

    for (const firebaseUser of plan.candidates) {
      try {
        const email = normalizedEmail(firebaseUser.email!);
        const result = await withTimeout(
          createOrGetFirebaseUser({
            firebaseUid: firebaseUser.uid,
            email,
            username: getInitialUsernameSeed(firebaseUser.displayName, email),
            displayName: firebaseUser.displayName || getInitialUsernameSeed(null, email),
            photoURL: firebaseUser.photoURL,
            isAdmin: false,
            plan: "SIDE_KICK",
            subscriptionStatus: "active",
            // A Firebase profile already exists, so recovered collectors should
            // return directly to the Vault rather than repeat first-run setup.
            onboardingComplete: true,
          }),
          ACCOUNT_CREATE_TIMEOUT_MS,
          "Recovered account creation",
        );
        if (result.created) created += 1;
        else converged += 1;
      } catch (error) {
        failed += 1;
        console.error("[Firebase Recovery] Safe account creation failed:", error);
      }
    }

    // Only mark recovery complete once every safe candidate either created or
    // converged. A failure deliberately leaves the marker absent so the
    // startup retry/restart path attempts recovery again.
    if (failed === 0) {
      await lockClient.query(
        "INSERT INTO startup_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [RECOVERY_MARKER],
      );
    }

    return {
      scanned: firebaseUsers.length,
      created,
      converged,
      failed,
      alreadyLinked: plan.alreadyLinked,
      skippedEmailConflict: plan.skippedEmailConflict,
      skippedMissingEmail: plan.skippedMissingEmail,
      alreadyCompleted: false,
    };
  } finally {
    if (locked) {
      await lockClient.query(
        "SELECT pg_advisory_unlock(hashtext($1))",
        ["firebase_only_account_recovery_v1"],
      ).catch(() => undefined);
    }
    await lockClient.query("RESET lock_timeout").catch(() => undefined);
    lockClient.release();
  }
}
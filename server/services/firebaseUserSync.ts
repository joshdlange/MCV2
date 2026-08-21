import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type InsertUser, type User } from "../../shared/schema";

export interface FirebaseUserSyncResult {
  user: User;
  created: boolean;
}

function usernameCandidates(baseUsername: string, firebaseUid: string): string[] {
  const base = baseUsername.trim().slice(0, 40) || "collector";
  const stableSuffix = crypto
    .createHash("sha256")
    .update(firebaseUid)
    .digest("hex")
    .slice(0, 6);

  return [
    base,
    `${base.slice(0, 33)}-${stableSuffix}`,
    ...Array.from({ length: 3 }, (_, index) =>
      `${base.slice(0, 31)}-${stableSuffix}-${index + 2}`),
  ];
}

/**
 * Creates a Firebase-backed user without leaking uniqueness races into auth.
 * A conflict on firebase_uid means another request already created this exact
 * account; a conflict on username advances to a deterministic fallback.
 */
export async function createOrGetFirebaseUser(
  userData: InsertUser,
): Promise<FirebaseUserSyncResult> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, userData.firebaseUid))
    .limit(1);
  if (existing[0]) return { user: existing[0], created: false };

  for (const username of usernameCandidates(userData.username, userData.firebaseUid)) {
    const inserted = await db
      .insert(users)
      .values({ ...userData, username })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { user: inserted[0], created: true };

    // Concurrent requests for the same Firebase account converge here. This
    // check also makes retries safe across autoscale instances.
    const raced = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, userData.firebaseUid))
      .limit(1);
    if (raced[0]) return { user: raced[0], created: false };
  }

  throw new Error("Could not create a unique collector account");
}
// Short-lived in-process cache of Firebase UID → user row.
// Removes the per-request DB lookup in authenticateUser while keeping
// plan/admin changes fresh: entries expire after 30s and are invalidated
// whenever storage.updateUser / deleteUser touch a user.
import type { User } from "@shared/schema";

const TTL_MS = 30 * 1000;
const MAX_ENTRIES = 5000;

type Entry = { user: User; expiresAt: number };

const byUid = new Map<string, Entry>();
const uidByUserId = new Map<number, string>();

export function getCachedUser(firebaseUid: string): User | undefined {
  const entry = byUid.get(firebaseUid);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    byUid.delete(firebaseUid);
    return undefined;
  }
  return entry.user;
}

export function setCachedUser(firebaseUid: string, user: User): void {
  if (byUid.size >= MAX_ENTRIES) {
    // Simple bound: drop everything rather than tracking LRU.
    byUid.clear();
    uidByUserId.clear();
  }
  byUid.set(firebaseUid, { user, expiresAt: Date.now() + TTL_MS });
  uidByUserId.set(user.id, firebaseUid);
}

export function invalidateUserById(userId: number): void {
  const uid = uidByUserId.get(userId);
  if (uid) {
    byUid.delete(uid);
    uidByUserId.delete(userId);
  }
}

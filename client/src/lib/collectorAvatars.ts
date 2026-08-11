/**
 * Collector avatar registry (Collector Profile Customization v1).
 *
 * Avatars live in client/src/assets/avatars/ as 512x512 WebP files named by
 * their stable key (e.g. avatar-07.webp). Users store only the key
 * (users.collector_avatar_key), never a file path, so assets can be reorganized
 * without touching user records.
 *
 * To add avatars later: drop <new-key>.webp into the assets/avatars folder.
 * The registry picks it up automatically. Never rename or renumber existing
 * files — keys are stored on user rows.
 */

const files = import.meta.glob<string>("../assets/avatars/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

/** key -> asset URL, sorted by key for a stable picker order */
export const AVATAR_MAP: Record<string, string> = {};
for (const path of Object.keys(files).sort()) {
  const key = path.split("/").pop()!.replace(/\.webp$/, "");
  AVATAR_MAP[key] = files[path];
}

/**
 * Keys shown in the public avatar picker. Keys prefixed with "reserved-" are
 * exclusive (e.g. the owner's personal avatar): they render anywhere via
 * AVATAR_MAP/avatarUrl but are hidden from the grid, and the server rejects
 * non-authorized users who try to select them.
 */
const selectableKeys = Object.keys(AVATAR_MAP).filter(
  (k) => !k.startsWith("reserved-"),
);

// Shuffle once per app load (Fisher-Yates) so every session sees the grid in a
// different order — avoids everyone gravitating to the same first few avatars.
for (let i = selectableKeys.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [selectableKeys[i], selectableKeys[j]] = [selectableKeys[j], selectableKeys[i]];
}

export const AVATAR_KEYS: string[] = selectableKeys;

export function avatarUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return AVATAR_MAP[key] ?? null;
}

export function isValidAvatarKey(key: string): boolean {
  return key in AVATAR_MAP;
}

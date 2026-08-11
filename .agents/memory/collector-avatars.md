---
name: Collector avatar registry
description: How collector profile avatars are keyed, stored, and validated
---
Avatar keys are the webp filenames (no extension) in `client/src/assets/avatars/` (512x512 WebP, currently avatar-01..avatar-94). Users store only the key in `users.collector_avatar_key`.

**Rules:**
- Append-only: never rename/renumber existing files — keys live on user rows forever. New avatars = drop `<new-key>.webp` in the folder; client registry (import.meta.glob) and server validation both pick it up automatically.
- Server validates keys against that same directory (lazy-cached Set in routes.ts); client registry alone is not an integrity boundary.
- Collector tagline reuses `users.bio`; public toggle reuses `profileVisibility` — do not add duplicate columns.
- `allow_followers` / `show_activity_in_feed` default false and are reserved for the future follows/feed features; nothing consumes them yet.
- Keys prefixed `reserved-` are exclusive: hidden from the picker (client filters them out of AVATAR_KEYS) and server rejects selection unless `isAdmin`. The owner's reserved avatar is auto-assigned by an idempotent startup seed (only when the key is NULL). Picker order is shuffled per app load. Server key validation fails closed if the avatars dir is unreadable.

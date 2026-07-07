---
name: Collector profile privacy enforcement
description: Where and how to enforce collector-profile visibility so private profiles don't leak via the API.
---

# Collector profile privacy must be enforced per-endpoint

The public collector profile is served by a *family* of endpoints, not one:
`/api/collectors/:username` plus siblings `/wishlist`, `/badges`, `/contributions`,
`/trade-block`. Each is a separate `app.get(...)` and each fetches its own data.

**Rule:** every data-returning collector endpoint must run the same access gate
(block check + `profileVisibility` check) before returning data. Use the shared
`resolveCollectorAccess(username, callerId)` helper in `server/routes.ts` (defined
just above the collectors routes). It returns a discriminated result:
`{ ok:false, status, message }` or `{ ok:true, targetUser, isOwnProfile }`.

**Why:** gating only the main `/api/collectors/:username` route is a false sense of
security — the UI 403s into an error state, but a direct API call to a sibling
endpoint still returns wishlist/badges/contribution data for a "private" profile.
UI-level hiding is NOT a security boundary.

**How to apply:** when adding any new `/api/collectors/:username/*` data endpoint,
call `resolveCollectorAccess` first and early-return on `!ok`. `trade-block` is an
empty placeholder so it currently needs no gate; add one the moment it returns real
data. The "Collections" and "Ratings" tabs render from the gated main-profile
response, so they have no separate endpoint to protect.

## profileVisibility field
- Column `profileVisibility` on `users` is tri-state: `public | friends | private`.
- The Account Settings UI exposes only a binary "Show my Collector Profile publicly"
  toggle (public vs private). To avoid silently widening a stored `friends` value,
  **only the dedicated public-profile toggle writes `profileVisibility`** — the
  generic privacy/notification save path must never include it. The social endpoint
  `PUT /api/social/profile/visibility` is what sets `friends`.
- Whitelist incoming values against `['public','friends','private']` on write.

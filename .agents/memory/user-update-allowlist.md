---
name: PUT /api/users/:id allowlist
description: Self-service user update route must allowlist fields; privileged flags on users table are otherwise self-escalatable
---
The generic user-update route (`PUT /api/users/:id`) previously passed `req.body` straight to `storage.updateUser`, so ANY new privileged column on `users` (isAdmin, trustedUploader, plan, subscription/stripe fields) was instantly self-escalatable by any logged-in user.

**Why:** Found by architect review when adding `trusted_uploader` (July 2026) — the flag gates image-approval bypass, so self-set = moderation bypass.

**How to apply:** The route now uses a `SELF_SERVICE_FIELDS` allowlist. When adding any new column to `users`, decide: profile/preference → add to the allowlist; privileged → leave out and expose only via a dedicated admin route. No frontend callers use this route currently (checked July 2026), so allowlist changes are low-risk.

---
name: Marketing email opt-in & unsubscribe
description: How marketing opt-in, the unsubscribe mechanism, and List-Unsubscribe headers are wired together.
---

# Marketing email opt-in & unsubscribe

- **`marketingOptIn` is the single field that gates marketing sends.** The drip and campaign queries filter on `eq(users.marketingOptIn, true)`. There is a separate, older `emailUpdates`/`emailNotifications` field that does NOT gate marketing — don't confuse them. New signups default `marketingOptIn = true`; users opt out via Account Settings toggle or the unsubscribe link.

- **Unsubscribe link injection is placeholder-driven.** `sendResendEmail` scans the html for the literal `{{UNSUBSCRIBE_URL}}`. If present, it replaces it in html+text with a per-recipient signed URL AND adds `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058).
  - **How to apply:** any NEW marketing template must include `{{UNSUBSCRIBE_URL}}` in its footer or it silently ships with no unsubscribe link/headers. Transactional templates (password reset, etc.) intentionally omit it.

- **Unsubscribe tokens are stateless HMAC.** `unsubscribeToken(email)` = HMAC-SHA256(`SESSION_SECRET`, lowercased+trimmed email), first 32 hex chars. Verified with `timingSafeEqual`.
  - **Why:** it hard-fails (throws) if `SESSION_SECRET` is absent rather than falling back to a guessable secret — a fallback would make the unauthenticated `/api/unsubscribe` state change trivially forgeable.

- **Public `/api/unsubscribe`** handles GET (link click → white-bg confirmation page) and POST (one-click). Matches user by `lower(trim(email))` and sets `marketingOptIn=false`.

- **Admin `POST /api/admin/marketing/opt-in-all`** is a one-time bulk opt-in (sets `marketingOptIn=true` where email non-empty and currently false, returns count). Must run in the DEPLOYED app after publish — the dev/sandbox executeSql against prod is read-only.

---
name: PC binder share funnel
description: How binder share analytics + signup attribution work; constraints for extending them
---
- Counters are raw bot-inclusive events: `pc_binder_share_links.view_count` (every GET of the public page) and `share_count` (every share-button tap, owner modal or public page, via public POST `/api/pc-share/:token/share-click`, throttled in-memory 20/hr per IP+token).
- Signup attribution: shared page stores `mcv_ref_share_token` in localStorage; all three `/api/auth/sync` callers send it as `refShareToken`; server stamps `users.signup_share_token` at account creation ONLY, after validating the token exists.
- **Why:** Joshua tracks shared binders as an organic acquisition funnel; admin-only signup numbers (Admin → Analytics), owners see views/shares in the share modal.
- **How to apply:** never add `signup_share_token` to the PUT /api/users allowlist; new share surfaces must call the share-click endpoint; attribution must stay creation-time-only.

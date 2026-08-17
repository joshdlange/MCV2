---
name: Push notification infrastructure
description: FCM push tokens/sends for the mobile apps — service design, secret naming, and hard rules
---

- Service lives in `server/pushNotifications.ts` (additive module); tables `push_tokens`/`push_logs` are created lazily on first use (db:push blocked convention).
- Firebase Admin credential is `FIREBASE_SERVICE_ACCOUNT_KEY` (NOT `_JSON` — external specs guess the wrong name; `_JSON` is accepted as an alias in the push service only). routes.ts initializes the default app at boot.
- Segments map to `users.plan`: 'superhero' = SUPER_HERO, 'sidekick' = SIDE_KICK.
- Hard rules from Joshua: no crons/blast automation. ONE approved automatic trigger exists: new-message push (`notifyNewMessage` — generic body only, never message content; per recipient+sender 2-min in-memory throttle; bundles as "N new messages"). Any other automated push still needs explicit approval. Registration endpoint caps 20 tokens/user (oldest-updated evicted) and rejects malformed tokens; dead FCM tokens are pruned on send.
- **Why:** launched ahead of a store release; keeping sends manual avoids accidental blasts while native registration is still rolling out.
- **How to apply:** any future automated push (drips, event triggers) needs explicit approval and should reuse sendPushToUser/sendPushToSegment + push_logs, never raw FCM calls.

## User opt-out (push_enabled)
- `users.push_enabled` (default true) gates ALL sends: both sendPushToUser and sendPushToSegment filter `u.push_enabled = true`. Any new send path must join users and apply the same filter.
- Preference is read/written ONLY via GET/POST `/api/user/push-preference` (auth-gated, self-only) — not the PATCH profile notifications map.
- **Pitfall:** `storage.updateUser` swallows DB errors and returns `undefined` — routes must check the return value or they report success on failed writes.

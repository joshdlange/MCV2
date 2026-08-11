---
name: Feed v1 architecture
description: How the activity feed, reactions, reaction XP, and leaderboards work; rules new feed work must follow.
---

# Feed v1

- `feed_events` / `feed_reactions` are decoupled (no FKs) like xp_events. Every event insert must go through `emitFeedEvent` with a stable `dedupe_key` (unique index) — that's what makes emission and admin backfill idempotent. Never insert feed events raw without a dedupe key.
- **Privacy is enforced at READ time, not emission time**: events are written for everyone, but `getFeedPage`, leaderboards, and reaction endpoints (`getReadableEvent`) all require author `profile_visibility='public' AND show_activity_in_feed=true` (owner always sees own). Any new feed-reading endpoint must apply the same predicate — UI hiding is not a boundary.
- Reaction XP (first of UTC day +5, others +1, cap 10/day) is claimed inside a transaction holding `pg_advisory_xact_lock(892031, userId)`; the claim row (even 0 points) plus the partial unique index `xp_events_feed_reaction_idx (user_id, feed_event_id) WHERE event_type='feed_reaction'` makes toggling/re-reacting permanently non-awarding. **Why:** concurrent reactions otherwise read the same daily total and blow past the cap (caught in review).
- `computeUserXp` includes `feed_reaction` ledger points — any new XP source must be added there too or it silently doesn't count.
- Feed pagination uses a composite cursor `(created_at, id)`; timestamp-only cursors skip same-timestamp rows (backfill writes many).
- `user_collections` has `acquired_date`, NOT `created_at` — backfill/window queries against it must use acquired_date.
- Leaderboards exclude `is_admin` users (Joshua's bulk imports would top every week).
- Set-completion events intentionally omitted: no reliable server-side computation exists.

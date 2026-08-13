---
name: Badge system pitfalls
description: How badges are awarded, why string ids fail silently, and time/race rules for badge checks
---

- `badgeService.awardBadge(userId, badgeId)` takes a NUMERIC badge id; badges are runtime DB rows looked up via `getBadgeByName`. Passing a slug string fails silently (error is caught and only logged), and a badge that has no row in `badges` can never be awarded — new badge code must ship with an idempotent startup seed inserting the badge by name.
- **Why:** the Contributor badge shipped as `awardBadge(userId, 'contributor')` with no DB row; prod logged `invalid input syntax for type integer` on every image approval for months and nobody ever earned it.
- Login-triggered badge checks race with `recordUserLogin` (fire-and-forget update of `last_login`). Any check that compares against the previous login must take the caller-captured `priorLastLogin` param (Welcome Back, Never Leave You Again pattern), never re-read `users.last_login`.
- Time-of-day badges must use US Eastern via `Intl.DateTimeFormat(... timeZone: 'America/New_York')` — the server runs UTC, raw `getHours()` awards "night" badges in the afternoon.
- `users.upgraded_at` (first paid upgrade) is stamped by a DB trigger `users_set_upgraded_at` (BEFORE INSERT OR UPDATE, only when transitioning to SUPER_HERO and NULL) — new upgrade code paths need no manual stamping. Loyalist measures from it.


## Retro/bulk badge awards must stay quiet
Bulk retro grants stamped earned_at=now() once flooded the feed with identical badge_earned posts. user_badges.retro (boolean) marks bulk/retro seed grants; feed backfill excludes them. All retro-award seeds MUST insert with retro=true, run post-listen in runDataFixSeeds, and create-badge + retro-award + feed cleanup atomically in ONE marker-gated tx (rolling-deploy race). feed_reactions now has ON DELETE CASCADE FK to feed_events. Collection-count thresholds (50/100/250/500/1000) are all badges now — never re-add plain collection_milestone feed emits.

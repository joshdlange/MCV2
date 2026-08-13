---
name: Badge system pitfalls
description: How badges are awarded, why string ids fail silently, and time/race rules for badge checks
---

- `badgeService.awardBadge(userId, badgeId)` takes a NUMERIC badge id; badges are runtime DB rows looked up via `getBadgeByName`. Passing a slug string fails silently (error is caught and only logged), and a badge that has no row in `badges` can never be awarded — new badge code must ship with an idempotent startup seed inserting the badge by name.
- **Why:** the Contributor badge shipped as `awardBadge(userId, 'contributor')` with no DB row; prod logged `invalid input syntax for type integer` on every image approval for months and nobody ever earned it.
- Login-triggered badge checks race with `recordUserLogin` (fire-and-forget update of `last_login`). Any check that compares against the previous login must take the caller-captured `priorLastLogin` param (Welcome Back, Never Leave You Again pattern), never re-read `users.last_login`.
- Time-of-day badges must use US Eastern via `Intl.DateTimeFormat(... timeZone: 'America/New_York')` — the server runs UTC, raw `getHours()` awards "night" badges in the afternoon.
- `users.upgraded_at` (first paid upgrade) is stamped by a DB trigger `users_set_upgraded_at` (BEFORE INSERT OR UPDATE, only when transitioning to SUPER_HERO and NULL) — new upgrade code paths need no manual stamping. Loyalist measures from it.

## Retro/bulk badge awards vs feed backfill
Retro badge seeds stamp earned_at = now(), and the feed backfill emits one badge_earned post per recipient → a wall of identical feed cards (Contributor, 32 posts, Aug 2026; cleaned via startup_migrations marker contributor_feed_spam_cleanup_v1). **How to apply:** any future retro badge award must backdate earned_at or be excluded from feed emission/backfill. Badge rows also need icon_url set at seed time or the feed shows a generic ribbon.

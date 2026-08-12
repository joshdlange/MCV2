---
name: Follow/Friends system v1
description: How follows, friends (mutual follows), feed filters, and the Top 10 Collector badge work
---

- Follow is one-way (`follows` table, created via startup DDL); Friends = mutual follows, always DERIVED (never stored) so unfollow instantly dissolves friendship.
- Followable = `profile_visibility='public'` OR `allow_followers=true`; bidirectional blocks always refuse. `resolveCollectorAccess` 'friends' visibility now accepts EITHER legacy accepted `friends` rows OR mutual follows — keep both honored.
- Feed filters following/friends restrict by follow set but the public + show_activity_in_feed privacy predicate STILL applies — following someone never bypasses their privacy.
- DELETE follow always works (even if target went private/blocked after) but only returns counts/relationship data when the access guard passes.
- No XP for following (farm-loop risk); no emails for follows. In-app follow notification exists ("follow back to become Friends" nudge) — new-row-only + 7-day per-pair cooldown via notifications table lookup, so unfollow/refollow can't spam.
- Legacy `friends` table is UNIFIED with follows (Aug 2026): accepted legacy friendships were migrated into mutual follows (blocked pairs excluded); friend-request acceptance dual-writes mutual follows via `makeFriends`; unfollow deletes the legacy accepted `friends` row too. `makeFriends` bypasses followability but never blocks. New signups auto-friend the creator account (user 337) in BOTH systems. The profile "Add Friend" button was removed — Follow button is the single ladder (Follow → Following → Friends).
- All-time Top 10 XP leaderboard (feedService) awards the permanent "Top 10 Collector" badge on computation (Hall of Fame precedent: never revoked). Badge seeded by name via topTenBadgeSeed; icon is an AI-generated placeholder at /uploads/badges/top-10-collector.png — Joshua intended to supply his own image (attachment never arrived).

**Why:** spec required privacy-safe social graph; architect review caught (1) unfollow leaking target data past privacy changes, (2) mutual follows locked out of friends-only profiles.
**How to apply:** any new endpoint exposing follow counts/relationships must run resolveCollectorAccess; any new feed filter must retain the read-time privacy predicate.

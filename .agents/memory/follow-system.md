---
name: Follow/Friends system v1
description: How follows, friends (mutual follows), feed filters, and the Top 10 Collector badge work
---

- Follow is one-way (`follows` table, created via startup DDL); Friends = mutual follows, always DERIVED (never stored) so unfollow instantly dissolves friendship.
- Followable = `profile_visibility='public'` OR `allow_followers=true`; bidirectional blocks always refuse. `resolveCollectorAccess` 'friends' visibility accepts MUTUAL FOLLOWS ONLY (legacy `friends` rows no longer grant access — they were migrated).
- POST /api/collectors/:username/follow is deliberately NOT gated by resolveCollectorAccess — private/friends-only profiles must stay followable or mutual friendship can never form; followUser enforces blocks + followability itself.
- GET /api/collectors/:username returns a 200 `limited:true` locked-card payload (avatar, username, relationship, visibility) for private/friends-gated viewers instead of 403; child endpoints (wishlist/binders/badges/etc.) still 403 via resolveCollectorAccess.
- Feed filters following/friends restrict by follow set but the public + show_activity_in_feed privacy predicate STILL applies — following someone never bypasses their privacy.
- DELETE follow always works (even if target went private/blocked after) but only returns counts/relationship data when the access guard passes.
- No XP for following (farm-loop risk); no emails for follows. In-app follow notification exists ("follow back to become Friends" nudge) — new-row-only + 7-day per-pair cooldown via notifications table lookup, so unfollow/refollow can't spam.
- Legacy `friends` table RETIRED from reads (Aug 2026): accepted + pending rows migrated into follows at startup (pending → one-way follow, rows archived as 'archived_pending', never hard-deleted). Legacy endpoints kept for old mobile builds but map onto follows: friend-request POST = follow; friend-requests/pending-invitations return []; DELETE friend/:id resolves a caller-owned friendship ROW id to its counterpart first, else treats :id as a user id. Social Hub = Followers/Following/Friends sub-tabs from GET /api/social/relationships.
- Friend badges (Friendly Face, Squad Assembled, Friendship is Magic, storage friend_count) all count mutual follows; followUser fires checkBadgesOnFriendChange for BOTH users on every new follow row.
- All-time Top 10 XP leaderboard (feedService) awards the permanent "Top 10 Collector" badge on computation (Hall of Fame precedent: never revoked). Badge seeded by name via topTenBadgeSeed; icon is an AI-generated placeholder at /uploads/badges/top-10-collector.png — Joshua intended to supply his own image (attachment never arrived).

**Why:** spec required privacy-safe social graph; architect review caught (1) unfollow leaking target data past privacy changes, (2) mutual follows locked out of friends-only profiles.
**How to apply:** any new endpoint exposing follow counts/relationships must run resolveCollectorAccess; any new feed filter must retain the read-time privacy predicate.

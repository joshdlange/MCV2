---
name: Unified collector profile hub
description: The single-hub profile architecture and the badge rarity taxonomy gotcha
---

# Unified collector profile hub

`/collectors/:username` (`CollectorProfile.tsx`) is the ONE profile experience.
Public collector tabs are visible to everyone; an owner-only `Settings` tab
renders `AccountSettings.tsx` (gated by server-computed `isOwnProfile`).
`/profile` is kept only as a thin wrapper around `AccountSettings` for the
fallback case where a user has no `username`.

**Why:** The app previously had two disjointed profile pages that drifted apart.
Consolidating into one hub keeps owner and public views in sync.

**How to apply:** Do NOT re-add a second standalone profile/settings page or
duplicate settings UI. New profile/settings features go into the hub (public tab
or the owner Settings tab / `AccountSettings`). Gating is enforced server-side —
the client `isOwnProfile` tab gate is cosmetic only.

## Badge rarity taxonomy gotcha
Badge rarities are **bronze / silver / gold / platinum / special** — NOT
common/uncommon/rare/epic/legendary. A lookup keyed on the wrong set silently
falls back to a default style, so wrong-key bugs are invisible (no error, just
wrong colors). `Social.tsx` is the source of truth for the gradient/glow styling;
the shared visual lives in `client/src/components/profile/BadgeIcon.tsx` (renders
real `iconUrl` artwork when present, else a name-keyed Lucide fallback). Reuse
BadgeIcon rather than re-deriving rarity styles.

## Collector XP
XP shown on the hub = badge points (falls back to `DEFAULT_BADGE_XP[rarity]`) +
image-contribution XP, run through `computeXpProgress` in `shared/xp.ts`
(50 levels). Progress bar uses `xpIntoLevel / xpForNextLevel` (span, not
cumulative) and `progressPct`. Keep the profile and contributions endpoints using
the same XP formula so totals agree.

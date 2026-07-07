---
name: Two separate profile pages
description: The collector-profile vs account-settings split and the badge rarity taxonomy gotcha
---

# Two separate profile pages (public vs private)

There are TWO distinct pages, deliberately kept apart:
- `/collectors/:username` (`CollectorProfile.tsx`) = the PUBLIC collector profile.
  Tabs only: Overview, Trade Block, Wishlist, Collections, Badges, Images,
  Ratings. There is NO embedded Settings tab. The owner-only "Settings" button
  here navigates (`setLocation("/profile")`) to the private page.
- `/profile` (`profile.tsx` → `AccountSettings.tsx`) = the PRIVATE Account
  Settings (Personal / Social / Billing / Privacy), titled "Account Settings",
  with a "Back to Collector Profile" button. It always renders the *current*
  user's own settings, so one user can never see another's settings.

**Why:** An earlier iteration MERGED settings into the collector hub as an
owner-only tab; that conflated the public profile with private account settings.
This was reverted to a clean public/private split. Do NOT re-merge them or
re-add an embedded Settings tab to `CollectorProfile.tsx`.

**How to apply:** Public-facing profile features → a tab on `CollectorProfile`.
Account/settings features → `AccountSettings`. Profile visibility is enforced
server-side per-endpoint — see `collector-profile-privacy.md`.

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

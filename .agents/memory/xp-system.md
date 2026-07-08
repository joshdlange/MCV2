---
name: XP / Collector Power system
description: How user XP is computed and awarded; the single source of truth and the hybrid ledger-vs-derived model.
---

# XP / Collector Power system

XP shown on the dashboard "Collector Power Meter" and on CollectorProfile come from ONE
function: `computeUserXp` in `server/services/xpService.ts`. Both the collector endpoint and
`GET /api/user/xp-summary` call it. Any new XP surface must call it too — do not recompute XP
inline anywhere else.

## Hybrid model (important)
Total XP = badge XP + image XP + card XP + share XP, from different places:
- **Badge XP** and **Image XP** are DERIVED at read time (badges from `user_badges`, images from
  approved `pending_card_images` via `imageContributionXp`). They are NOT stored in the ledger.
- **Card XP** comes from the `xp_events` ledger, summed over rows with `event_type = 'card_added'`
  only (filter by event_type so future event types don't leak into the "Cards" total).
- **Share XP** (binder shares) also comes from the ledger: `subset_binder_share_first` (+25 once
  ever) and `subset_binder_share_daily` (+10 max once/user/day). Summed separately as `shareXp`.

**Why:** badge/image counts are already authoritative in their own tables, so storing them in a
ledger would risk double-counting. Card-added XP needs a ledger to be farm-proof (see below).

## The ledger is deliberately decoupled
`xp_events` has NO foreign keys (cardId etc. are plain columns). **Why:** the ledger must never
block a card or user deletion, and XP history should survive even if a card row is removed.
Account deletion explicitly cleans `xp_events` inside its transaction.

## Farm-proofing
+1 XP per card added, awarded once per (user, card) forever. Enforced by a UNIQUE index on
`(user_id, event_type, card_id)` plus `awardCardAddedXp` doing INSERT ... ON CONFLICT DO NOTHING
(try/catch, never throws). Remove + re-add gives no new XP because the event row is never deleted.
Both add paths funnel through `storage.addToCollection`, which is the sole caller.

**How to apply:** when adding a NEW event type (e.g. set-completed +100, already reserved in
`shared/xp.ts` as a TODO), remember card_id is NULL for it, and Postgres treats NULLs as distinct —
the existing unique index will NOT dedupe it. Give set-completed its own dedupe key/index, and add
its own component to the total in `computeUserXp` rather than folding it into the card sum.

Binder-share XP follows that pattern: `subset_binder_share_first` is deduped by a PARTIAL unique
index on user_id (`WHERE event_type='subset_binder_share_first'`); the daily +10 uses an atomic
guarded INSERT (`WHERE NOT EXISTS` today's row) — no expression index. Award happens server-side
only after a client-confirmed share (native share success or clipboard copy), never for social
window.open buttons (unconfirmable). The award endpoint also requires an ACTIVE owned share link,
so direct-API farming caps at +10/day. `card_set_id` on xp_events is plain metadata (no FK).

## Backfill
`backfillCardAddedXpIfEmpty` runs once on startup (idempotent, ON CONFLICT-safe). It backdates
`created_at` to each collection row's `acquired_date` so backfilled XP does not flood the recent-XP
feed with "today" events.

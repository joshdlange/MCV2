# Backlog

Items agreed with the owner; none are scheduled yet.

## Before main is ever published

- **Review `server/seeds/mergeDuplicateLegacySets.ts`.** Since the live build (`f1d92ca`) it includes
  `repair1994FlairPowerBlast` (`c6113e2`), which deletes duplicate card rows (with admin audit-log
  entries) as part of the startup data-fix seeds, i.e. against production on boot. The owner must
  review it before `main` is published.

## eBay

- **Market Trends listing links are not affiliate-tracked.** `server/ebay-browse-api.ts:90` sends the
  literal placeholder `affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>` in
  `X-EBAY-C-ENDUSERCTX`. Fix it to the real EPN campaign ID in a later release.

## Phase C (visual search in production)

- **Reuse the C0 full-catalog vectors** in the production index wherever the URL and content digest
  match. Download and embed only new or changed images.
- **Embed on save:** every image add or change (admin upload, approved collector photo, crop-queue
  result) embeds that one image when it is saved (single-image path). No catalog-wide batch jobs.

## PRIORITY before Phase C dev testing: refresh the dev catalog from a production snapshot

**Goal:** card IDs (and images) in dev match production, so dev testing of collection adds, scan
confirm and image approvals is meaningful. Dev-only; **no production writes**; production is read in
one read-only transaction.

**Proposed safe procedure** (plan; needs approval before running):
1. **Back up dev first:** a `pg_dump` of the dev database (`helium/heliumdb`) into the persistent
   project volume, plus a tested restore command.
2. **Read-only production export** of catalog tables only: `main_sets`, `card_sets`, `cards`, and any
   catalog-only lookup tables they reference, in one `READ ONLY REPEATABLE READ` transaction against
   the approved host. No users, collections, scans, orders or other personal data.
3. **Load into dev in one transaction:**
   - Truncate and reload those catalog tables, keeping IDs exactly as production has them.
   - Reset their ID sequences to production's maximums.
   - The loader hard-refuses any host but `helium`, and the production connection is read-only.
4. **Dev rows that point at catalog IDs** (dev users' collections, wishlists, scan uploads, pending images,
   visual references) would point at the wrong cards afterwards. They are test data, so the proposal is
   to clear those dev tables or remap them by card identity. This decision belongs to the owner and is
   listed explicitly before running.
5. **Verify:** row counts and an ID-by-identity check equal production's. The app boots in dev, and
   tests pass.
6. **Keep it repeatable:** one script, run on demand whenever dev drifts again.

## Dev database has diverged from production (before Phase C dev testing)

- **What:** 24,135 card IDs refer to different cards in dev and production. That is every ID above
  540,000 (the two databases assigned new IDs independently) and about 1,690 below 530,000 (set merges
  and moves, plus 182 edits). Production also has about 14,600 more cards with a usable image.
  Measured 2026-10-01, read-only.
- **Why it matters:** anything tested in dev that stores or compares card IDs (collection adds,
  scan confirm, image approvals, feedback, wishlists) can silently point at the wrong card when the
  result is compared with production.
- **Needed:** propose options before Phase C dev testing (for example, refresh dev's catalog from a
  production snapshot, or key cross-environment test data by card identity). No action yet.

---
name: Parallel-leak fix count verification
description: How the parallel-leak repoint was verified safe, and the prod archived-card anomaly found along the way
---

# Parallel-leak fix count verification (Aug 2026)

- Verified in dev with a true before/after snapshot: capture per-user `sum(quantity)`/row counts for user_collections, user_wishlists, pc_binder_cards BEFORE restarting the workflow (startup seeds only run on restart), then diff after. All totals were identical; zero rows left pointing at archived cards.
- **Why this works:** repointAndArchive merges quantities into the survivor before deleting, so aggregate quantity is invariant by construction — but only a real snapshot diff proves it.
- **How to apply:** any future card-merge seed should be verified the same way: baseline snapshot → restart → per-user diff → "rows on archived cards = 0" invariant.
- xp_events is decoupled (no card FK), so merges never touch XP — no ledger check needed.

## Prod anomaly (pre-existing, unrelated)
Production has ~39 user_collections rows pointing at cards archived by the old "Legacy duplicate set merged" passes. Dev has zero. Likely cause: collectors could still add archived cards after the merge (search/add path may not filter archived), or prod merges ran before repointing was added. Needs cleanup + a guard preventing adds of archived cards.

## Update (Aug 2026)
The ~39 prod anomaly rows are handled by `server/seeds/fixArchivedCollectionRows.ts` (set-based, resolves canonical ids at runtime from archive_reason regex `merged into card N` / `[canonical=N]`, so dev/prod id drift doesn't matter). storage.addToCollection now blocks archived cards (redirects to canonical when resolvable, else throws). Wishlist add path is NOT yet guarded.

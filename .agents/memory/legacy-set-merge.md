---
name: Legacy duplicate-set merges
description: Pitfalls & patterns for merging duplicate card sets / repointing user data in bulk
---

The idempotent slug-based merge seed (`server/seeds/mergeDuplicateLegacySets.ts`) is the reference pattern for bulk card merges. Lessons baked into it:

- **Per-card repointing is too slow for startup seeds.** ~1,100 cards × ~12 statements over Neon never finished before workflow restarts killed the tx. Use set-based SQL with a `merge_pairs` temp table (see `applyPairBatch`).
- **Parallel subsets share the base checklist**, so number+name match is often ambiguous. Prefer the subset named `% - Base`, then non-parallel/promo/signed subsets; abort otherwise.
- **Canonical subsets contain identical twin rows** (e.g. 1993 base #32 twice). Dedupe twins (same subset+number+normName+variation) as part of the merge or matching fails.
- **Unique-constraint traps when repointing card_id:** `user_collections`/`user_wishlists`/`pc_binder_cards` per-user uniques AND `xp_events (user_id,event_type,card_id)` farm-proof index — every one needs a dedupe/merge pass before the UPDATE.
- **`listings.user_collection_id` is a NOT NULL FK** — repoint listings to the surviving collection row before deleting duplicate collection rows.
- **Why:** merge ran in dev Aug 2026 (1992/1993 Masterpieces, 1994 Hildebrandt, 1995 Fleer, 2023 UD Platinum, ~950 owned rows repointed); ships to prod automatically on republish; row IDs differ between dev and prod so everything resolves by slug + number/name.
- **How to apply:** any future duplicate-subset cleanup (Feb-2026 "-base" duplicates remain) should reuse this seed's matching tiers and batch applier.

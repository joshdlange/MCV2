---
name: /api/stats wishlist field mismatch
description: The optimized stats endpoint's response shape doesn't match the shared CollectionStats type
---

**Rule:** When reading the wishlist count from `/api/stats`, read both field names: `(stats as any).wishlistItems ?? (stats as any).wishlistCount`, and treat a non-number as "unknown" (never assume 0).

**Why:** `/api/stats` is served by the optimized stats path, which returns `wishlistCount`, while the shared `CollectionStats` type (and the older storage path) declare `wishlistItems`. Trusting the type produced `undefined → 0` and made the dashboard mission card claim every user's wishlist was empty. The type lies; the Collection Snapshot tile has always guarded with the dual read.

**How to apply:** Any new consumer of `/api/stats` must use the dual-source read, or (better, if ever refactoring) align the optimized endpoint's field name with the shared type in one deliberate change across all consumers.

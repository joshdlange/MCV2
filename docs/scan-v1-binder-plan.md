# Binder page mode — plan only

Reuse the single-card artwork/version tile in a **3×3 pocket grid**. Do not build
this until single-card accuracy, photo consent and atomic saves pass acceptance.

1. Capture one page, detect up to nine pocket regions, and let the collector correct
   boundaries or mark empty pockets. Preserve page position and show each crop.
2. Run bounded recognition per occupied pocket; reuse top-artwork selection,
   inline versions, close-match choices and “Not here?” search. Show pending,
   matched, unresolved and skipped states independently.
3. “Add all” adds only explicitly selected/resolved pockets. Show the count before
   saving; unresolved pockets never become guesses. Allow individual Add/skip too.
4. Use a server-side idempotent batch with the same ownership limits and XP rules.
   Default to distinct cards, not automatic quantity increases for repeated artwork.
   Return per-pocket outcomes; retries must not duplicate adds. Undo touches only
   newly created, unchanged rows. If capacity is insufficient, explain before writes.
5. Retain no photos on ordinary Add all. Missing-image offers remain separate,
   optional decisions for search-picked cards; never bulk-submit a binder photo.
   Wrong-image reports retain their reason and optional-attachment behavior.
6. Test glare, sleeves, tilted pages, rotated pockets, empty pockets, mixed versions,
   duplicate cards, partial failures, cancellation, limits and low-memory phones.
   Compare per-pocket recall and whole-page time against nine single-card scans.

**Estimate:** 5–8 engineering days after single-card v1 is stable, plus real-page
testing. Pocket detection and glare are the main uncertainties. No binder code
or “Add all” endpoint was added for this plan.
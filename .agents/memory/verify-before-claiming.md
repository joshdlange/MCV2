---
name: Verify before claiming (never guess)
description: User-mandated rule — never present a diagnosis or fix as done without verifying against production evidence first.
---

**Rule:** Never guess. Before telling Joshua a problem is diagnosed or fixed, verify against actual production data (read-only psql on NEON_DATABASE_URL: ledgers, timestamps, URL patterns, binder contents). Before shipping a repair, confirm the affected cards/sets are actually the ones the user is looking at (ask for the exact binder/set name or a screenshot if needed).

**Why:** Aug 6, 2026 — shipped a twin-merge image repair believing it fixed Joshua's binder; his "MM Purple" binder (Epic Purple parallels) was never touched by the twin merge — its wrong images came from bad COMC source URLs present since ≤Mar 2, made permanent by the Aug 4–5 external-image migration. He republished for nothing (republishes disrupt active users). Trust was damaged.

**How to apply:** For any "images are wrong/reverted" report: get the exact binder/set, query prod for those exact card ids (evidence sources: card_image_backup, pending_card_images, image_migration_failures, merge_image_repairs, cards.updated_at, last_image_search_attempt), and only then diagnose. State uncertainty explicitly when evidence is incomplete.

---
name: Verify before claiming (never guess)
description: User-mandated rule — never present a diagnosis or fix as done without verifying against production evidence first.
---

**Rule:** Never guess. Before telling the user a problem is diagnosed or fixed, verify against actual production data (read-only psql on NEON_DATABASE_URL: ledgers, timestamps, URL patterns, binder contents). Before shipping a repair, confirm the affected cards/sets are actually the ones the user is looking at (ask for the exact binder/set name or a screenshot if needed).

**Catalog import verification:** Successful row insertion and an idempotent second run do not prove a set is visible. Check the actual collector-facing set-list response before claiming an import is ready.

**Publishing handoff:** The user explicitly requires related fixes to be completed and verified together before asking them to republish; do not make them repeat visibility requirements.

**Why:** Repeated incomplete checks forced multiple publishes for the same catalog addition. Verify the already-imported repair case as well as fresh imports, and distinguish workspace readiness from verified live delivery.

**Why:** The Fox Kids checklist imported completely but was hidden by catalog eligibility filtering. Database counts and a login screenshot missed this.

**How to apply:** Verify the imported parent and subsets against the same eligibility rules used by browse endpoints, then confirm the public listing includes the parent. Repeat on production after publishing.

**Why:** A repair was once shipped on the belief it fixed the user's reported binder, but the binder's cards were never touched by that repair's root cause — the wrong images came from a different, older source. The user republished for nothing (republishes disrupt active users) and trust was damaged.

**How to apply:** For any "images are wrong/reverted" report: get the exact binder/set, query prod for those exact card ids (evidence sources: card_image_backup, pending_card_images, image_migration_failures, merge_image_repairs, binder_image_repairs, cards.updated_at), and only then diagnose. Note: the same card often exists as multiple rows (base/parallel/variant subsets) — a user's "reverted" fix may simply live on a sibling row. State uncertainty explicitly when evidence is incomplete.

---
name: Card-number natural sort
description: card_number is text; every ORDER BY on it needs the numeric-aware CASE/LPAD pattern
---

`cards.card_number` is a text column, so plain `ORDER BY card_number` sorts 1, 10, 11, 2.

**Rule:** every server-side ordering on card_number must use the numeric-aware pattern:
`CASE WHEN card_number ~ '^[0-9]+$' THEN LPAD(card_number, 10, '0') ELSE card_number END`
(or `card_number::integer` variant used by the paginated set endpoint).

**Why:** lexicographic orderings kept resurfacing in new endpoints (pickers, previews, shared links, missing-cards) even after the main set page was fixed — the bug re-enters with every new card-list query.

**How to apply:** when adding any endpoint or query returning a card list ordered by number, copy the CASE/LPAD pattern; client-side sorts already use a prefix+number comparator, so the fix belongs server-side.

---
name: Card-number natural sort
description: Card numbers require token-aware natural sorting on both the client and server.
---

`cards.card_number` is a text column. Plain lexical order sorts `1, 11, 2`, while numeric-only padding still sorts prefixed values as `AU-24, AU-3`.

**Rule:** client lists must use the shared token-by-token card-number comparator. Server queries must use the matching shared SQL natural-sort key and a stable card-ID tie-breaker for pagination. Do not add raw, integer-only, or LPAD-only card-number ordering.

**Why:** duplicated partial fixes handled plain numbers but failed prefixes such as `AU-3`; omitted tie-breakers also made equal card numbers unstable between pages.

**How to apply:** route every user-facing card list through the shared comparator or SQL key. Regression coverage must include `1, 2, 11, 12`, `AU-3, AU-4, AU-24`, and multi-number values such as `A1-2, A1-11`.

---
name: Parallel duplicates remediation
description: Duplicate-card parallels often already exist in the matching parallel subset — moving them creates duplicates; merge is needed instead.
---

Rule: when moving "(Gold)"-style parallel cards from a base subset into their matching parallel subset, ~1/3 of them **already exist** in the target subset (same character, same number). A collision guard on target set_id+card_number is mandatory; blocked moves usually mean "redundant copy — needs cross-subset merge," not a bug.

**Why:** Measured on dev data (July 2026): of 2,483 matched parallel groups, ~820 were clean moves, ~852 were redundant copies already present in the target, ~811 targets were occupied by a *different* card (needs eyes). `mergeDuplicateCards` deliberately refuses cross-subset merges, so the redundant-copy bucket has no automated path yet.

**How to apply:** Use the Parallel Moves tool (admin Data Quality page / `moveParallelCards`) for the clean bucket only; it re-validates inside the transaction under `pg_advisory_xact_lock(hashtext('data_quality_parallel_moves'))` — keep that pattern for any future bulk remediation. Subset matching must be whole-token tiered (exact trailing-segment first), never substring ("Red" matches inside "Sacred").

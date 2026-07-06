---
name: Postgres LIMIT without ORDER BY causes non-deterministic candidate retrieval
description: Any query using ilike/or() with a LIMIT for candidate narrowing needs an explicit ORDER BY, or repeated identical queries can return different row subsets across runs.
---

When retrieving "candidate" rows for scoring/ranking (e.g. fuzzy search narrowing before an in-app scoring pass), a `SELECT ... WHERE ... LIMIT N` with no `ORDER BY` does not guarantee the same N rows on repeated identical calls. Postgres may return a different subset depending on query planner choices, making downstream ranking (e.g. "top match") flaky/non-reproducible even when the scoring logic itself is deterministic.

**Why:** Discovered while building a card-scan matching engine (`server/services/scanMatching.ts`) — a test harness run twice against the same DB produced different top-ranked matches for the same input. The bug was not in the scoring/sort logic (which had a proper tiebreaker) but in the candidate-retrieval queries themselves, which used `.limit(80)` with no `.orderBy(...)`.

**How to apply:** Whenever building a staged/narrowing retrieval query that uses `LIMIT` before further in-memory scoring or ranking, always add a deterministic `.orderBy(primaryKey)` (or another stable column) to the query. Also add a deterministic secondary/tertiary sort key in the final in-memory sort (e.g. sort by score desc, then by number of corroborating signals, then by id asc) so ties resolve identically every time — useful for writing repeatable test harnesses against live data.

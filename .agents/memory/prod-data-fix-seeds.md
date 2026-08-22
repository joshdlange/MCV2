---
name: Prod data fixes via startup seeds
description: How to change production data when the prod DB is read-only from dev
---
Prod DB is read-only via executeSql({environment:"production"}), BUT the NEON_DATABASE_URL secret is a direct *writable* connection to the live prod DB (verified July 2026: counts match the prod replica exactly). One-off batch scripts can run from dev with `DATABASE_URL="$NEON_DATABASE_URL"`; for code-shipped fixes, data changes reach prod through deployed code. Established pattern: idempotent seed in `server/seeds/*`, dynamically imported by the post-listen `runDataFixSeeds` sequence in `server/index.ts`.

**Why:** autoscale can boot multiple instances at once; read-then-insert seeds raced and could duplicate/partially apply.

**How to apply:** wrap the whole seed in `db.transaction` and take `pg_advisory_xact_lock(hashtext('seed-name'))` first (node-postgres pool keeps the tx on one connection). Match rows by slug/card_number, never by prod IDs (dev IDs differ). Rehearse in dev by planting fixture rows that mimic the prod state, run twice to prove idempotency. Before deleting any card, count refs across user_collections, user_wishlists, pc_binder_cards, listings, xp_events, migration_log_cards, card_image_backup — a restrictive FK failure rolls back the entire fix. Silver/parallel subsets clone name+number only (no images).

Also: the admin "add cards" modal misfiled cards into the wrong set once (July 2026, Kakawow) — suspected set-selector bug, not yet investigated.

## Seeds must not block the port (2026-08-13 publish failure)
Heavy first-run seeds ran before `server.listen`, took ~85s in prod, and the deployer only waits ~60s for port 5000 → publish failed ("required port was never opened"). Fix: run heavy data-fix seeds AFTER listen through the awaited `runDataFixSeeds` sequence, with a write-gate middleware that 503s card-reference writes until seeds finish.
**How to apply:** any new startup seed that can do minutes of real prod work goes in `runDataFixSeeds` (post-listen), never before `registerRoutes`. A seed that archives or merges cards must be awaited inside that gated sequence, not launched from route registration. Keep the gate aligned with every namespace that can create card references, including collection, wishlist, binders, cards, scans, and `/api/marketplace`. If a required archival/merge seed fails validation or execution, rethrow it and leave the gate in its failed state—opening writes would create fresh references on rows the next boot still needs to merge.

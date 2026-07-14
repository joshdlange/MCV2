---
name: Prod data fixes via startup seeds
description: How to change production data when the prod DB is read-only from dev
---
Prod DB is read-only via executeSql({environment:"production"}); data changes reach prod only through deployed code. Established pattern: idempotent seed in `server/seeds/*`, dynamically imported at startup in routes.ts (near initializeUpcomingSets).

**Why:** autoscale can boot multiple instances at once; read-then-insert seeds raced and could duplicate/partially apply.

**How to apply:** wrap the whole seed in `db.transaction` and take `pg_advisory_xact_lock(hashtext('seed-name'))` first (node-postgres pool keeps the tx on one connection). Match rows by slug/card_number, never by prod IDs (dev IDs differ). Rehearse in dev by planting fixture rows that mimic the prod state, run twice to prove idempotency. Before deleting any card, count refs across user_collections, user_wishlists, pc_binder_cards, listings, xp_events, migration_log_cards, card_image_backup — a restrictive FK failure rolls back the entire fix. Silver/parallel subsets clone name+number only (no images).

Also: the admin "add cards" modal misfiled cards into the wrong set once (July 2026, Kakawow) — suspected set-selector bug, not yet investigated.

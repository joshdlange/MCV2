# Cut-down Scan to Add: step 1 handoff

## Scope

Owner's cut-down instruction supersedes the broader `scan-v1-plan.md`:
DEV only; never publish; production read-only; retain everything in `.local/`.
Stop after catalog refresh. Steps 2–5 have NOT been implemented.
Later: existing C0 arm C vectors, five families/version picker, existing search,
existing confirm/add and photo submission, photo-free telemetry.
Skip OCR, auto-rotation, instant re-indexing and hosting studies.

## Completed 2026-10-01

- Before-step code checkpoint: git tag `scan-v1-before-step1-20261002`.
- Full dev backup: `.local/scan-v1/catalog-refresh/20261001234234229/dev-before.dump`.
  Private/ignored, mode 0600. Contains dev account data: never publish or present as an asset.
- Restore actually rehearsed into an isolated database on the dev host:
  `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname <isolated-dev-db> <backup>`.
  Credentials supplied via PG environment, never command arguments.
  Every public table's count, full catalog content hashes and account-content hashes matched.
  The temporary rehearsal database was dropped; the backup and all files remain.
- Only production `main_sets`, `card_sets`, `cards` exported. Source session and
  pg_dump both enforce read-only; pg_dump shares the exporter's repeatable-read snapshot.
- Exact copied counts: **482 main sets, 5,800 card sets, 217,459 cards**.
  Ordered ID hashes and full-row hashes match the production snapshot for all three.
- Dev references cleared: collections, wishlists, scans, pending images, binder entries,
  dependent test commerce rows, migration/image/price caches, catalog-linked XP/feed/audit rows,
  and favorite-set IDs. Empty binder containers, accounts, unrelated data, upcoming releases
  and interests preserved. Upcoming published links remapped by main-set slug.
- ID sequences restarted at catalog max + 1. Foreign keys remain enforced.
- Load + cleanup + verification are one transaction. Initial attempt rolled back because
  pg_dump clears search_path; corrected, then reused the same source export successfully.
- Claude's detached app process was already gone when inspected. Normal `Start application`
  Run workflow restored. No detached replacement process.
- `SCAN_VISUAL_RETRIEVAL=on` enabled **only in development**. Code default remains off;
  no production environment change. While enabled in non-deployed dev, automatic catalog
  repairs/image migration/upcoming publication are suppressed to prevent immediate drift.
  Disabling the dev flag re-enables the normal automatic catalog maintenance.
- App main-set API returned 200; card API returned production identity
  `548422 = Sentry #79`. Public sign-in screenshot verified; signed-in UI not exercised.
- Full catalog hashes still matched after startup and API requests.
  Targeted tests: 17 passed, one optional DB integration test skipped.
  New script/helper and changed index/publication files have no LSP diagnostics.
  The large routes file still has typing errors in unrelated existing sections;
  this is not a clean project-wide type-check claim.

## Repeat / verify

Stop the application and other dev DB clients first. Create a fresh code checkpoint.

```sh
NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on node_modules/.bin/tsx scripts/dev-refresh-catalog.ts --apply
NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on node_modules/.bin/tsx scripts/dev-refresh-catalog.ts --verify .local/scan-v1/catalog-refresh/20261001234234229/manifest.json
```

The script makes a new backup and restore rehearsal before every fresh export.
It refuses non-dev/non-helium targets and unknown FK-dependent tables.
`--resume <manifest>` retries a rolled-back prepared load only after checking backup/export
hashes, unchanged table counts and absence of other dev DB clients. It does not re-query production.
The manifest contains counts/hashes, no account contents. SQL and dumps must remain private.
For recovery, stop Run and restore the full backup into an isolated dev database first using
the rehearsed command; replacing the active dev database is a separate destructive operation.

## Assessment for next session

- Removing OCR fusion is supported by C1 (slower and less accurate); do not bring it back.
- Family matching is not exact parallel identification. Inspect the existing family key before
  trusting it; final ownership must use the explicitly selected catalog card ID.
- Missing/bad references and unconfirmed leakage still limit accuracy. Do not claim the model
  is reliable just because the flow is usable.
- C1 had zero retries, so the earlier retry-timing concern did not affect its reported run.
- Measure full client upload → displayed candidates after step 3, separately from model time.
- Backlog's production startup deletion review remains a publish blocker; no publishing here.
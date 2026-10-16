# SoldGraph gradual migration and manual bulk refresh

Provider activation and publishing remain separate approval steps. This command
is not imported by app startup and has no HTTP endpoint or schedule. Only an
operator with server-shell and database/secret access can run it.

## Display source

- Positive usable SoldGraph results (including stale ones) take precedence.
- Before a successful SoldGraph result, return the existing latest legacy cache
  value, if positive. No old-provider network request is made by the read.
- A successful zero-usable-comp response keeps the positive legacy estimate as
  fallback. Its source is `LEGACY_ACTIVE_ESTIMATE`, provider `legacy`,
  confidence `estimate`, and `soldgraphSource` is `SOLDGRAPH_NO_COMPS`.
  `soldgraphAttempted` distinguishes an empty result from never refreshed.
- Without a positive legacy fallback, zero comps return null/unavailable.
- Three or more usable comps: `SOLDGRAPH_SOLD_COMPS`; one or two:
  `SOLDGRAPH_LIMITED_DATA`. Both use provider `soldgraph`.
- An upstream failure preserves the previous SoldGraph result and legacy cache.
- Legacy prices are never written into the SoldGraph result or counted as sold
  comps. Minimal labels identify legacy estimates without changing layout.
- Rollback remains unsetting/changing PRICING_PROVIDER and restarting.

## Commands

Dry-run is the default; it performs one free usage API request, not a search:

```sh
npx tsx scripts/soldgraph-bulk.ts --dry-run --max-cards 100 --reserve 100
```

Only after reviewing the estimate, an authorized operator can explicitly spend:

```sh
npx tsx scripts/soldgraph-bulk.ts --execute --confirm-search-spend --max-cards 100 --reserve 100
npx tsx scripts/soldgraph-bulk.ts --execute --confirm-search-spend --resume <job-uuid>
```

The maximum card limit defaults to 100 and has a hard ceiling of 500 per job.
Reserve defaults to 100 and can be configured with `--reserve`. Resume preserves
the original job reserve; `--max-cards` limits work in that invocation. Job IDs and
status counts are printed; raw provider/database errors and credentials are not.
Dry-run may initialize additive tables but does not create a job, change quota
snapshots, or call a search endpoint.

## Eligibility and priority

Only non-archived cards with required query metadata, expired/missing SoldGraph
cache and no active retry cooldown qualify. Fresh zero-result caches are skipped,
even if a legacy fallback is displayed.

1. Explicit Check Value demand (recorded going forward; no historical backfill).
2. Cards in user collections with positive quantity.
3. Recent views: omitted because no clean existing per-card view signal was found.
4. Cards in personal collection binders.
5. Cards with a legacy price-cache row, oldest first.
6. Catalog additions within seven days.
7. Remaining eligible cards.

Ties are deterministic (request date, legacy date, creation date, card ID). No new
view-analytics infrastructure was introduced. Counts describe the current
development database, not the published catalog.

## Quota, concurrency and recovery

Each invocation reads `/v1/usage` once at startup, validating plan, limit, used,
remaining and window. Unknown/unlimited/null formats fail closed. The command
uses provider remaining minus reserve, capped by max cards, eligible cards and
existing local rolling daily/30-day budgets (still 20/80 by default).

On execution only, a shared quota snapshot stores the remaining balance,
reserve and local reservation-ledger baseline. Every subsequent application or
operator search reserves one unit under the existing transactional budget lock.
The baseline is captured before the usage check, conservatively accounting for
concurrent application requests. Errors may overcount locally; no refunds are
assumed. Exhausted snapshots keep blocking until an operator obtains a new one.
Rolling expiry may free more provider capacity, but never increases a job's
budget automatically.

Calls from other tools/accounts sharing the allowance are not visible to this
local ledger after the startup snapshot. Avoid simultaneous external consumers;
the reserve is protection against uncertainty, not an account-wide guarantee.
Quota/rate-limit/provider errors stop the job and preserve prices.

A database advisory lock permits only one operator bulk invocation across
instances, plus the existing per-card refresh locks shared with the app. Durable
job/item rows allow a paused job to resume only pending cards. In-flight rows
left by a crash become `uncertain`, never automatically reissued; failures are
retained for operator review. A job with failed/uncertain items remains paused,
not falsely complete. Processed fresh cards use cache without spending.

The loop runs sequentially with a 1.5-second pause after each completed item.
No scheduler is enabled. A future authorized scheduler could call this same
bounded runner, but must not bypass its quota/locking safeguards.

## Batch decision

Not used. Sequential requests allow strict per-card reservations, cache reuse
and safe stop-on-error without implementing a second job/polling pipeline.
Official documentation checked on 2026-10-16:

- https://soldgraph.com/docs/api/batches
- https://soldgraph.com/docs/api/usage

These specify one credit per completed search, including cache hits and zero
rows; pending searches hold one credit. Failed/rejected searches are free.
Batch creation and polling are free, not the searches inside a batch. The
documented response example has two completed searches and `credits: 2`.
This was documentation-verified, NOT verified by submitting a live batch.
No implementation relies on batch discounts or batching to bypass quota.

## Verification

```sh
NODE_ENV=development npx tsx --test server/tests/soldgraph.test.ts server/tests/soldgraph-migration.test.ts
```

Integration tests use a temporary isolated PostgreSQL schema, mocked provider
responses and zero live searches. They cover fallback, positive replacement,
empty results, priority, dry-run counts, reserve stopping, resume, interrupted
items, fresh-cache skipping, per-card/cross-job locks and failure preservation.

Observed development dry run on 2026-10-16: Lite, limit 2,000, used 7,
remaining 1,993, rolling_30_days. 214,925 eligible cards; max 100; reserve 100;
local budget room 11; estimated searches 11. The existing development reservation
ledger includes earlier replay-test reservations, so local room is conservative
and is NOT the provider's remaining balance. No limits were raised and no
reservations erased. One free usage call, zero search calls, no live bulk run.

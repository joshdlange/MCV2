# SoldGraph development pilot

## Production integration prepared (not enabled or published)

`server/pricing/soldgraph-cache.ts` now provides an additive shared PostgreSQL cache.
`PRICING_PROVIDER=soldgraph` opts GET, batch and refresh pricing routes into this
provider. Unset or any other value retains the old implementation. No environment
switch was changed. Restart the service after an approved switch or rollback.
The old provider and card_price_cache remain intact. Other collection-value
aggregations and the separate Trends feature are outside this integration.

The new tables are initialized transactionally on first SoldGraph use, under a
schema advisory lock. This requires CREATE TABLE permission. The separate cache
stores provider, card ID, query, JSON result (median, ranges, counts, dates and
per-row diagnostics), refreshed/expiry times and retry cooldown. Public responses
omit raw diagnostics and credentials. There is no price-history backfill.

Reads never call SoldGraph. Explicit authenticated refresh returns fresh shared
cache entries or reserves one provider request, protected by a per-card PostgreSQL
session advisory lock. A concurrent caller receives cached data with refreshing=true.
Fresh and empty-result responses expire after 24 hours. Stale cached values survive
provider errors. A durable 15-minute cooldown prevents immediate retries after
failure or process interruption. No scheduled refresh was introduced.

Shared rolling request reservations enforce SOLDGRAPH_DAILY_BUDGET (default 20)
and SOLDGRAPH_30_DAY_BUDGET (default 80), deliberately conservative for the observed
Free account. These count attempted searches, including ambiguous failures, not
only billed provider credits. They do not account for calls made outside this
integration. Confirm provider plan/remaining credits before increasing budgets.
The Free plan is one-time, so these rolling safeguards are not a substitute for
checking its remaining allowance. One anchored query per refresh; no auto fallback.

Normal: >=3 usable comps. Limited: 1–2 comps, price plus explicit Limited data text.
Unavailable: 0 comps, null price, never a $0 valuation. Best Offers remain excluded.
UI changes are conditional on the provider response so current live wording stays
unchanged until approval. Source selection affects pricing routes only, not legacy
cached collection total calculations.

Integration test command:
`NODE_ENV=development npx tsx scripts/test-soldgraph-cache.ts`
This uses saved live pilot pages against the real development PostgreSQL cache.
It tests all seven cards, cross-connection duplicate suppression, fresh/read reuse,
expiry, failure retention, cooldown and budget denial. It makes zero provider calls.
It writes only the new SoldGraph tables, including conservative test reservations.
Do not run it against production.

This is an operator-only CLI, not a replacement for the live pricing routes.
Run with `NODE_ENV=development`; all other environments fail closed. No application
entry point imports the pilot. No schema, catalog, collection, existing cache,
affiliate link or frontend changes are made.

## Commands

```sh
NODE_ENV=development npx tsx scripts/soldgraph-pilot.ts 557056
NODE_ENV=development npx tsx scripts/soldgraph-pilot.ts 557056 --fallbacks
NODE_ENV=development npx tsx scripts/soldgraph-pilot.ts --usage
npx tsx --test server/tests/soldgraph.test.ts
```

Use verified local identity, not production IDs: in this development snapshot,
557056 is Knull FF-23 Green Speckle /99; 557954 is Mantis Purple Sapphire.
The tool accepts up to six IDs per run, serially, one search each by default.
`--fallbacks` permits up to three anchored queries, stopping after a usable result.
It never paginates. Reruns reuse raw responses and reapply current matching code.
Full per-row diagnostic JSON is written under ignored `.local/soldgraph-qa/`.

## Existing flow audit

CardDetailModal's Check Value calls useRefreshCardPricing, POST
/api/card-pricing/:cardId/refresh, then EbayPricingService.forceRefreshCardPricing.
The old service queries Browse active listings using its subset-based query
builder, filters character/number and excludes graded titles, retains at most five
of ten requested listings, and averages asking prices multiplied by 0.85.
No shipping or explicit FX conversion is applied. The Knull production query
omitted parent/year and removed FF-23's hyphen.

GET /api/card-pricing/:cardId reads storage.getCardPricing. Batch reads use the
service cache path, which may fetch active estimates when absent. Existing
card_price_cache holds avgPrice, recentSales (URLs), salesCount, lastFetched,
but no provider, methodology, currency, expiry, or actual sale-price history.
Ordinary reads do not enforce TTL; explicit refresh bypasses the cache. Positive
old prices can survive empty refreshes. Background refresh jobs are separate.
UI and hooks still consume avgPrice/salesCount. None of these paths was changed.

## Pilot interpretation

The client calls only SoldGraph, using server environment SOLDGRAPH_KEY.
Each request has a deadline, redirects are rejected, and job URLs must be on
api.soldgraph.com under /v1/jobs/. At most six long polls are permitted within a
120-second search deadline. Errors are sanitized. No automatic new-search retries
are made after network errors. The initial request carries an idempotency key.

Relevant Best Offer rows remain diagnostic comps but do not enter the median.
Unknown offer status, price ranges, missing/invalid prices, non-USD prices, and
missing sold dates do not enter the median either. Duplicate listing IDs are
excluded. Shipping is reported separately. Empty usable samples return null,
not a zero-dollar valuation. Low/high/date range use the same usable sample.

SoldGraph describes these as displayed sold-listing prices, not a verified
transaction ledger. Its sold-date year is inferred from eBay's displayed date.
Same physical serial numbers can appear in multiple listing IDs: those might
be resales or relists, not independently verified transactions.
Commercial sourcing/display rights remain a production approval gate.

## Cache and usage recommendation

The pilot uses a 24-hour raw-response cache in /tmp/mcv-soldgraph-pilot, isolated
from existing prices. Zero-result pages are also cached. Concurrent identical
queries in one pilot instance share one request. Failures do not overwrite caches.
This is a disposable single-process development cache, not durable production
storage or a distributed lock; concurrent separate CLI processes are not supported.

Recommend 24 hours for an eventual on-demand production cache (not scheduled
refresh of the entire catalog). A 12-hour cache could double costs for hot cards.
For 2,000 credits/30 days, one search per distinct expired card costs:
20/day = 600/month; 50/day = 1,500; 60/day = 1,800; 100/day = 3,000.
Fallback searches add credits. Polls are free; SoldGraph's own 15-minute cache
hits still cost a credit. Ordinary UI reads must never call SoldGraph.

Observed usage on 2026-10-16: Free, 7 used, 100 limit, 93 remaining, one_time.
Do not assume the Lite allowance is enabled just because it is in the brief.

## Migration after explicit approval

1. Confirm account plan and commercial-use permission; review raw samples and
   repeated serial listings. Do not call estimates verified transaction amounts.
2. Add separate provider-tagged persistent results, currency, median methodology,
   usable count, Best Offer count, fetched/expiry times. Preserve the old cache.
3. Route approved Check Value refreshes behind a disabled-by-default provider
   switch. Add shared per-card locking, a daily quota budget, bounded fallbacks,
   and durable pending-job/idempotency handling. Do not adopt the dev /tmp cache.
4. Reads remain cache-only. Keep stale results with truthful timestamps on failure;
   never silently substitute active estimates for sold comps or store errors as $0.
5. Update only pricing labels/counts to describe the actual source and usable
   sample. Do not redesign the page. Keep rollback to old provider explicit and
   truthfully labeled. Validate platform behavior, then ask before publishing.

## Verified live pilot results

| Development card | Raw | Relevant | Best Offers excluded | Usable | Median USD |
|---|---:|---:|---:|---:|---:|
| 557056 Knull Fanfare Green Speckle /99 | 7 | 7 | 0 | 7 | 60.00 |
| 533899 Knull 129 Base | 200 | 8 | 0 | 8 | 1.33 |
| 543094 Knull FF-23 Fanfare | 200 | 178 | 24 | 154 | 8.39 |
| 557156 Knull Fanfare Gold Speckle /50 | 2 | 2 | 1 | 1 | 174.99 |
| 557106 Knull Fanfare Purple Speckle /75 | 44 | 4 | 2 | 2 | 162.50 |
| 557356 Knull Fanfare SuperFractor 1/1 | 1 | 1 | 0 | 1 | 5100.00 |
| 557954 Mantis Purple Sapphire | 0 | 0 | 0 | 0 | unavailable |

Samples look relevant after excluding Sapphire contamination from regular base.
Sparse variants (one or two comps) are not robust market valuations.
The 1/1 unexpectedly had a result; it is not claimed as an empty-result test.
The actual empty Mantis response exercises unavailable pricing.
The initial base search reports 368 matches but only 200 rows were retrieved;
results are page-limited, not exhaustive histories.

Knull primary query:
`2026 Topps Chrome Marvel Knull FF-23 fanfare green speckle`

No fallback was needed. Seven usable prices were 60, 86.29, 65, 60, 46.01, 61,
49.88; median 60, low 46.01, high 86.29, dates 2026-07-22 through 2026-09-01.
55/99, 20/99 and generic /99 examples were found; 07/99 was not in this response.
The two 98/99 listings have different IDs/dates; possible relisting is a limitation.
No 0.85 multiplier, currency conversion, shipping addition, or provider summary
substitution was used.

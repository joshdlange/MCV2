# SoldGraph failure audit — November 9, 2026

## Decision

**B — KEEP, BUT LIMITED, provisionally. Do not keep the current broad experience unchanged.**

SoldGraph demonstrably returns useful Marvel sales that our implementation rejects.
It is not defensible to cancel it on the premise that it has no Marvel data.
It is also not defensible to claim the current integration broadly earns its $9/month:
only 16/50 sampled cards produced any usable comps, and 9/50 produced three or more.
Retain it only for validated product families while evaluating narrow fixes.
This is a technical recommendation, not a subscription change or authorization to publish.

## Scope and limitations

- 50 real production catalog cards, across 26 main-set families, years 1990–2026.
- Source: existing production SoldGraph diagnostics, read-only, captured October 17–21, 2026.
- Selection: round-robin by main-set family, ascending card ID within family, then year/ID; first 50 of 76 cached production cards. No selection on result quality.
- This is a cache-based failure audit, not 50 fresh searches, a random catalog survey, or a reconstruction of the owner's exact 20 clicks. ID-order and cache availability bias the sample. It includes base, inserts, numbered/non-numbered variants, scarce/autograph targets, and low-priced cards. The sparse expensive targets do not establish a reliable high-value success rate.
- Budget estimate before searches: **zero new searches needed for the saved-response baseline**. Actual SoldGraph provider calls: **0**, including no usage calls, retries, fallbacks, or bulk jobs.
- Queried production metadata and cache only. No database writes in either environment.
- Current metadata generates the same first query as the stored query for all 50 cards.
- Saved diagnostics retain every returned listing's title, ID, offer flag, price/date fields, rejection/exclusion, and usability. They do not preserve the full raw response envelope, condition or price-range fields. Do not treat them as a lossless raw-response replay fixture.
- No matcher/query improvement implemented. No before/after improvement or measured query-recovery rate is claimed.
- Runtime provider-switch and display-age overrides were not inspected. Routing figures below are explicitly modelled from stored results and current positive legacy caches, not observed signed-in refresh outcomes.

## Baseline results

| Metric | Result |
|---|---:|
| Cards audited | 50 |
| New SoldGraph calls | 0 |
| Three or more usable comps | 9 / 50 — 18% |
| One or two usable comps | 7 / 50 — 14% |
| Zero usable comps | 34 / 50 — 68% |
| Returned listing rows, counted per card | 795 |
| Accepted identity matches | 188 |
| Usable price comps after exclusions | 154 |
| Rejected identity matches | 607 |
| Independently corroborated false rejections | **at least 19** |
| Confirmed false rejections / all rejections | **at least 3.13%** |
| Clear correct rejections in conservative triage | 225 |
| Rejections left uncertain | 363 |
| Cards with confirmed false rejections | 4 / 50 — 8% minimum |
| Cards with zero returned rows | 12 / 50 — 24% |
| Cards with genuinely inadequate provider coverage, independent of query | **Not established** |
| Suspected wrong-variant usable acceptances | 2 / 154 — 1.30% observed lower-bound concern, not certified false-positive rate |

Rows are query-card observations, not globally deduplicated physical sales.
Uncertain rows are not silently counted as correct or false.
The 19 confirmed false rejections establish identity errors, not 19 guaranteed usable prices:
Best Offer and other price exclusions still apply after identity correction.

### Fallback distinction

Immediately after those saved results, with today's legacy-cache availability, 21/50
(42%) would select LEGACY_ACTIVE_ESTIMATE because sold comps are absent.
The other 13 zero-comp cards lack a positive legacy value and remain unavailable.
This is a **modelled post-refresh fallback rate**, not a recorded historical UI rate.

All saved results are now older than the default 14-day display window. With that
default and no new refresh, 35/50 (70%) would display a legacy estimate and 15/50
would be unavailable—even though 16 cards have historical usable sold results.
That is the intended age policy in the checked-in code, not evidence that a new
provider request failed. A live successful refresh can change these outcomes.

## Primary causes for the 34 zero-comp cards

Every zero-comp card has one primary label in the CSV/JSON. Labels describe the
dominant observed failure; some causal judgments remain provisional.

| Primary cause | Cards |
|---|---:|
| NO_UPSTREAM_RESULTS | 12 |
| SERIAL_NUMBER_MISMATCH | 6 |
| CATALOG_METADATA_PROBLEM | 5 |
| INSUFFICIENT_SOLD_DATA | 3 |
| SET_NAME_MISMATCH | 2 |
| CARD_NUMBER_FORMAT_MISMATCH | 2 |
| ONLY_GRADED_RESULTS | 1 |
| ONLY_BEST_OFFER_RESULTS | 1 |
| ONLY_WRONG_PARALLEL_RESULTS | 1 |
| SUBSET_NAME_MISMATCH | 1 |

The top five are the first five rows (card-number formatting ties fifth).
NO_UPSTREAM_RESULTS means zero for that query, **not** proof of no sales or poor provider coverage.
The first rejection reason can obscure the practical cause: Random and Thunderstrike
mostly return generic pick-your-card listings, reported as character mismatches.
Accepting those listings would not yield defensible individual-card prices.

## Confirmed and material findings

### 1. Missing serial metadata is treated as a contradictory serial

`expectedSerial()` only recognizes slash numbering in subset/variation names, plus
one narrowly defined 2020 Masterpieces exception. If expected serial is absent,
**any observed /number causes wrong_serial_parallel**.

Blade #39 Blue Wave returned one unnumbered-title accepted sale and three /150
sales rejected as wrong serial. The same three listing IDs appear in the independent
Blue Wave sale history. Human Torch #51 Spider-Web returned six matching-looking
/399 titles but zero accepted comps. Doomasaur Purple Shimmer and Green Goblin
Purple RayWave show the same structural problem.

This is an interaction between matcher logic and incomplete structured parallel
metadata, not permission to accept arbitrary numbering. Cerebro results mix /99,
/25, /10 and /5; verify the base and parallel definitions before classifying them.

### 2. Season/year ranges are treated as conflicting years

Omega Sentinel B20 is catalogued as 2023–24 Annual. Its returned listing says
2023–2024 and is rejected as wrong_year because 2024 differs from the scalar
catalog year 2023. Independent history contains the **same listing ID**.
The generated query also includes the malformed standalone `-24` token.

### 3. Display labels are treated as mandatory seller wording

Gambit #12 Flair Power Blast returned genuine sales rejected for missing Annual,
Universe, or because Power Blast is spaced differently from PowerBlast.
Fourteen rejected listing IDs were independently corroborated on the same card's
sale-history page. Wolverine #23 has a corroborated false rejection for omitting Impel.

Gambit PB5 Masterpieces returned zero, yet independent history shows sales before
the cache capture. Its query requires the long catalog title including
Hildebrandt Brothers. Query over-constraint is a strong hypothesis, **not measured
causality** until a bounded alternate query is tested.

### 4. Number normalization is both too strict and too permissive

The current regex already tolerates FF-23 / FF23 / #FF-23 punctuation.
It does **not** normalize numeric leading zeroes, such as #038 versus 38.
Conversely it can match #46 within #46-V: two usable Jean Grey Blue Traxx results
explicitly say #46-V / VC. Those are suspected variant-cover contamination.
Fix suffix discrimination before broadening number matching.

### 5. Manufacturer and subset wording need product-aware treatment

Upper Deck / SkyBox / UD variations appear in Jean Grey titles. The existing
manufacturer alias is confined to 2020 Masterpieces; it cannot help this product.
This is not a reason to alias every Upper Deck and SkyBox product globally.
Rivals titles omit “image”; the matcher requires every remaining subset word.

### 6. Production never attempts generated fallback queries

The generator produces multiple strings, but refresh selects `[0]` and makes one
search. “Fallback” in refreshWithFallback means retaining cached pricing on error,
not trying a less restrictive SoldGraph search.

Additional searches cost credits. No alternate queries were executed during this audit.
Fallback recovery percentage is therefore unknown.

### 7. Useful upstream data exists; true coverage failure is unresolved

Nineteen externally corroborated rejects prove our implementation loses real comps.
Other responses consist entirely of graded, multi-card, wrong-variant or Best Offer
listings. These should not be rescued by indiscriminate loosening.
Zero-result searches alone cannot distinguish sparse coverage from overly long queries.

## Independent validation

15 sampled cards were compared with public PriceCharting sale-history pages, not
scraped eBay pages. IDs, source URLs and overlaps are in manual-validation.json
and the HTML report. Search-only results were not counted as validated sales pages.

The 15: Wolverine 23; DR. Doom 128; Wedding of Spider-Man 199; Gambit Power Blast 12;
Gambit PB5; Magneto CC16; Omega Sentinel B20; Professor X Cerebro 1; Jean Grey Blue
Traxx 46; Blade Blue Wave 39; Vengeance 115; Puma vs. Spidey 49; Thor Power Blast 13;
Colossus X-Fractor 23; Magik Rivals Image Variation 50.

Same listing IDs are strong evidence that SoldGraph returned a sale and our matcher
accepted/rejected it. Missing overlap is inconclusive: independent histories may
cover different dates, graded items, other variants, or sales after the cache capture.
PriceCharting histories can themselves contain misclassified variants; they are
corroborating evidence, not universal ground truth. No claim is made that every
rejected listing was manually certified.

## Smallest proposed generic rules — not implemented

| Concept | REQUIRED / STRONG | OPTIONAL | CONTRADICTORY |
|---|---|---|---|
| Card number | Exact normalized alphanumeric identity; preserve meaningful suffix | #, spaces, hyphen, numeric leading zeroes | Different number, prefix, or variant suffix |
| Character | Canonical identity or verified alias | Punctuation, verified abbreviation | Different character |
| Year | STRONG documented release year or season range | Seller omits year with other strong identity | Explicit year outside documented range |
| Set | REQUIRED distinguishing product family | Redundant marketing names after verified family match | Different product family |
| Subset | REQUIRED distinguishing insert identity | Approved spacing aliases; redundant label words | Different insert/variant |
| Parallel | REQUIRED exact variant evidence | Generic “Refractor” only where equivalent | Different color, foil, autograph or image variant |
| Serial | Validate against documented variant denominator | Numerator; missing denominator when variant is unambiguous | Conflicting documented denominator |
| Manufacturer | STRONG family-scoped alias | Missing manufacturer after sufficient family evidence | Different incompatible manufacturer/product |

Priorities:
1. Model known serial denominators separately from display labels; distinguish “unknown” from “wrong.”
2. Normalize documented release ranges and number formatting while rejecting variant suffixes.
3. Use verified family/subset aliases, including Power Blast spacing; do not globally weaken character or variant evidence.
4. Remove decorative catalog terms from search strings. Consider one bounded fallback only after zero useful primary results, under existing quota protection.
5. Keep Best Offer, graded, lot, wrong-variant and uncertain-price exclusions.

Unknown serial values must remain uncertain until checklist evidence resolves them.
No global Upper Deck/SkyBox substitution; no generic removal of Level 2.
What If punctuation already normalizes; Level 2 equivalence needs product-specific proof.

## Before/after

No improved matcher was implemented or replayed. The saved baseline is frozen.
Do not present optimistic recovery estimates as measured results. For a trustworthy
replay, use complete saved raw responses where available; the production diagnostics
omit fields used by price exclusions and grading checks.

## Product-value conclusion

The existing broad Check Value experience does **not yet demonstrate meaningful
reliable value for $9/month** across this sample. There is enough real upstream
data to justify a tightly scoped remediation evaluation, not a broad pricing rebuild
and not a confident cancellation based on coverage.

Query generation is likely hurting some results but its magnitude is unmeasured.
Matcher strictness materially hurts results and also has a suffix-related false-acceptance risk.
Catalog identity/serial metadata materially contributes. SoldGraph-wide Marvel
coverage insufficiency is **not established** by this audit.

Nothing published. Production data unchanged. No bulk job or provider search run.
Scan to Add, DINO, catalog images, collections, subscriptions, affiliate tracking,
and application pricing behavior were not changed.

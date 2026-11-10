# CompsAPI versus SoldGraph: controlled 50-card comparison

## Recommendation

**B — COMPSAPI IS BETTER BUT NEEDS MORE VALIDATION.**

CompsAPI provides materially more usable historical Marvel sales in this exact
cohort. It does not yet establish materially better *recent* valuation coverage.
Its returned three-year history yields 46% with 3+ usable comps; restricting those
same returned rows to the last 90 days yields 22%, equal to the frozen SoldGraph
headline benchmark. That sensitivity check is not a new matched-window provider
experiment: SoldGraph's exact original search window is not retained.

The $9/5,000-request tier looks more promising for historical comparisons than
continuing investment in SoldGraph. Do not switch production yet. Confirm
freshness policy, numbered-variant metadata, and accepted-offer price accuracy
before treating these medians as current Market Prices.

## Account and scope

- Exact original 50 IDs and frozen card metadata; no substitutions or catalog edits.
- Bearer authentication succeeded. Key used only server-side, never printed.
- Actual account: Free, 100 monthly requests, 10 requests/minute.
- Before: 0 used, 100 available. After: 78 used, 22 available.
- The search response accepted `days: 1095`; returned dates include older sales.
  Usage itself does not expose a history-cap field. This verifies the accepted
  window parameter, not exhaustive availability of every sale in that window.
- 50 primaries + 28 bounded fallbacks = 78 search calls. No pagination, retries,
  SoldGraph calls, or paid searches outside the cohort.
- Three non-search usage calls: initial authentication, saved pre-run snapshot,
  and post-run snapshot. They did not consume search credits.
- `/v1/sold`, size 200, page 1, cards=1, best_offer=1, print_run=any.
  Default mixed eBay US/international coverage, USD prices; shipping excluded.

## Results

| Metric | Frozen SoldGraph | CompsAPI after review |
|---|---:|---:|
| 3+ usable comps | 11/50 — 22% | 23/50 — 46% |
| 1–2 usable comps | 7/50 — 14% | 5/50 — 10% |
| Zero comps | 32/50 — 64% | 22/50 — 44% |
| At least one | 18/50 — 36% | 28/50 — 56% |

CompsAPI: 579 usable listing rows; 67 marked Best Offer; median 14 usable rows
per successful card. Average 1.56 searches/card and 7.42 usable rows/search.

Two cards recovered through actual fallbacks: Colossus #23 X-Fractor and Human
Torch #51 Spider-Web. Unknown serial metadata was verified where possible from
exact product definitions during offline review; no new calls were needed.

Head-to-head: **25 CompsAPI better, 2 SoldGraph better, 1 equivalent, 22 neither
useful**. Except the documented Iron Man precision override, outcomes compare
usable listing counts, not a claim that more rows alone proves better prices.
Both SoldGraph wins are Magik: Neon Rivals #50 (4 versus 1) and Mint Green Foil
#63 (4 versus 3). The equivalent card is 2025 Mint Elektra #95 (1 each).
Iron Man is a CompsAPI precision win despite equal counts: frozen SoldGraph
includes a case break and a Sparkle Foil; CompsAPI's final three are base titles.
The frozen SoldGraph counts were deliberately not rewritten.

## Best Offer findings

67 usable listing rows have best_offer=true. Including them changes CompsAPI
coverage from 21 to 23 cards with 3+ comps and 27 to 28 cards with any comp.
They are useful, but are not the principal explanation for the coverage gain.

These are **listing-level observations**, not 67 independently verified single
transactions. The API documents price as average paid per unit when a listing
sold multiple units; it is not always an individual transaction amount. The
report preserves units_sold, total_sales, offer flags, shipping and raw data.
We did not independently obtain buyer receipts or verify accepted prices.
An absence of best_offer=true is not proof of full asking-price payment.

## Quality review

Accepted title sets for all 28 successful cards were manually inspected, plus
sampled rejects. Title classifications and specific errors are in manual-review.json.
"Correct match" means the title appears to describe the target, not authentication
of the physical item or proof of its price.

- Final confirmed false positives remaining in the reviewed accepted titles: **0**.
  This is not a certified population precision rate.
- **At least 7 title-confirmed false rejections remain**, recorded individually:
  Wedding of Spider-Man missing Universe wording; Thunderstrike with a free
  top-loader incorrectly flagged accessory; Cable Returns referencing an older
  comic year; two Thor titles omitting Marvel; Thor #13/18 interpreted as a serial;
  Magneto's "1:72 PACKS" odds mistaken for a pack sale.
- Review caught and excluded multiple-card Wolverine/Dr. Doom listings, missed
  grading-company/numeric-grade titles, Iron Man Rivals/Diamante/Etch/foil
  variants, and 1UP-8 falsely matching bare 1.
- Uncertain grade and product descriptions were withheld, including NICE 9.5 and
  a Green Goblin listing with contradictory "Cosmic" wording.
- CompsAPI's structured flags are imperfect: Random the character triggers its
  mystery flag. We require actual mystery-product wording instead.
- Some title-consistent prices remain anomalous (Wolverine $231.10; Dr. Doom
  $173.50 and $94.95). No price accuracy claim is made for these; medians are
  unweighted item-price medians without arbitrary trimming or shipping additions.

## Every median disagreement above 25%

Difference = absolute(CompsAPI median − SoldGraph median) / SoldGraph median.

| Card | SoldGraph | CompsAPI | Difference | Most likely explanation from title review |
|---|---:|---:|---:|---|
| Puma vs. Spidey #49 | $3.78 | $1.32 | 65.1% | SoldGraph has only two rows, one NICE 9.5 uncertain-grade sale; CompsAPI excludes it and has broader history. |
| Gambit Flair PowerBlast #12 | $7.99 | $5.99 | 25.0% (strictly >25%) | Broader/older sale coverage and different returned listings; non-offer median remains $5.99. |
| Thor Flair PowerBlast #13 | $5.23 | $3.40 | 35.0% | 28 versus four rows and older sales; non-offer median also $3.40. |
| Dr. Doom Metal #128 | $8.99 | $6.50 | 27.7% | Broader time/price mix and changed listing-average prices; frozen SoldGraph also includes a two-card Iron Man/Dr. Doom listing, excluded here. |
| Blade Blue Wave #39 | $25.00 | $18.25 | 27.0% | 30 versus three rows, including 2024–25 history and seven offers. Non-offer median $16.99, so offers do not explain the lower median by themselves. |
| Jean Grey Blue Traxx #46 | $5.50 | $4.01 | 27.1% | More older lower-price sales; #46-V remains rejected. Non-offer median approximately $4.01. |
| Elektra Cosmos Die-Cut | $8.99 | $1.50 | 83.3% | One SoldGraph comp versus 16 title-consistent rows; broad price distribution/history. Non-offer median $1.25. |
| Iron Man Neon base #1 | $7.43 | $1.99 | 73.2% | Frozen SoldGraph includes a $138.45 12-box case break and Sparkle Foil. CompsAPI final set excludes both kinds. |
| Magik Neon Rivals #50 | $27.49 | $35.00 | 27.3% | CompsAPI returns only one usable row, also present in SoldGraph; missing cheaper listings/query coverage rather than proof of a price increase. |

These are plausible explanations supported by returned titles, counts and dates,
not experimental causal attribution. The providers were not averaged.

## Evaluator and query boundaries

Isolated scripts only; no import from the active SoldGraph matcher/cache and no
database connection. Queries retain year, core product, character, exact number,
and important variant wording. Fallback removes subset wording and redundant
Marvel wording, never searches on character alone.

Card-number prefixes/suffixes remain meaningful; explicit #1UP-8 is not #1.
Season ranges, PowerBlast, X-Fractor, RayWave and Spider-Web formatting normalize.
Character colors do not count as parallel evidence (Green Goblin).
Raw grades, lots, boxes, packs, breaks, known wrong variants and uncertain serials
are withheld. Best Offer prices are included instead of inheriting SoldGraph's
offer exclusion.

Known serial definitions used: 2024 Chrome Blue Wave /150; 2026 Chrome Spider-Web
/399, Purple Shimmer /75, Green RayWave /99, Purple RayWave /75; 2026 Neon Blue
/150, Green /99, Gold /50. Definitions are exact base-parallel mappings, not
arbitrary title-derived denominators or card-specific exceptions. Sources:

- https://www.tradercracks.com/2024-topps-chrome-marvel-trading-cards-checklist
- https://www.checklistinsider.com/2026-topps-chrome-marvel-comics
- https://www.collectosk.com/2026-topps-neon-marvel-trading-cards
- API schema, price semantics and tier reference: https://compsapi.com/docs

Unknown serial definitions remain uncertain (for example Kaine/Steel Spider
Alternate Universe and Hulk Epic Purple). Their no-comp states do not prove
provider absence: plausible sales are present but not safely admitted yet.

## Comparison limitations and freshness

This is a same-cohort comparison against the requested frozen baseline, not a
fully controlled provider-only experiment. SoldGraph captures are mainly October;
CompsAPI was collected November 10 with up to three years, international coverage,
an independently reviewed evaluator and additional verified parallel metadata.
Its larger counts can reflect history, query strategy, matcher changes, listing
aggregation and provider coverage. We cannot attribute the whole gain to the API.

As a sensitivity check, retaining only returned CompsAPI rows dated August 12,
2026 or later yields **11/50 with 3+ and 25/50 with at least one**. This is an
offline filter, not another API search. It demonstrates why 46% historical
coverage should not be sold as 46% reliable current-price coverage.

Only page one was requested. Some results advertise more pages; no page walks
were used. Null/zero-results and strict metadata failures remain in the cohort.
Fallback decisions used the initial evaluator; subsequent offline review fixed
errors and verified metadata. Thus some of the 28 fallback calls would no longer
be necessary under the final evaluator.

## Deliverables and reproduction

Full table: generated-artifacts/compsapi-audit/comparison.csv
Raw pages and account snapshots: generated-artifacts/compsapi-audit/
Per-listing decisions: comparison.json
Manual classifications: manual-review.json
Human-readable report: report.html

Offline reproduction (no provider calls):

    npx tsx --test scripts/compsapi-audit/evaluate.test.ts
    npx tsx scripts/compsapi-audit/report.ts
    npx tsx scripts/compsapi-audit/render.ts

Do not delete reservations and rerun paid collection. Original SoldGraph files
and production code remain untouched.

Nothing published. Production data and SoldGraph logic unchanged. eBay fallback
unchanged. No production provider selected. No catalog, image, mobile,
subscription, affiliate, DINO or Scan to Add changes.

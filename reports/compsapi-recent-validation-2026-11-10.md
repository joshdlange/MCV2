# Recent-sales final validation — November 10, 2026

## Decision: D — NEITHER IS GOOD ENOUGH

Neither provider is sufficiently validated to power a broad, automatic CURRENT
MARKET VALUE feature on this evidence. This is not a claim that neither has useful
sales, nor a recommendation to cancel accounts automatically. CompsAPI is better
for historical research and offers useful selective recent coverage, but this
test does not establish a reliable current-price replacement for SoldGraph.

The key distinction: 84% have at least one recent usable listing, but only 44%
have three within 90 days. Six-month coverage rises to 68%, with older prices
and thin current activity for those additional cards. We cannot establish price
accuracy against independent paid transaction records.

More importantly, these are saved **1,095-day query responses**. Their last_sold
field dates the latest sale on a listing; price can average multiple units sold
across the requested window. Filtering by last_sold does NOT necessarily turn
that price into a true 90-day transaction price. All window results below are
listing-recency estimates, not newly queried window-specific sale statistics.

## Cohort and cost

Exactly 25 cards selected from the existing 50, unchanged metadata. Selection
intentionally favors known marketplace activity, across older base cards,
inserts, Topps/Upper Deck, non-numbered and numbered parallels, low-dollar and
higher-dollar targets. It is purpose-sampled, not random or blinded to the
previous study. Both SoldGraph winners (the two Magik cards) are included.
Hulk Epic Purple and Kaine Alternate Universe retain unresolved serial metadata:
marketplace listings exist, but neither is counted as safely matched.

All data reused from today's saved comparison. **Zero new searches, zero
SoldGraph calls.** Two free CompsAPI usage checks bracket this validation.
Account: Free, 10 requests/minute, 78/100 used before and after, 22 remaining.
No upgrade. Cached active estimates were reused, not refreshed.

Reference time: 2026-11-10 15:40 UTC. No sale after that instant is included.

## Coverage

| Measure | Cards | Rate |
|---|---:|---:|
| Three or more within 30 days | 4 | 16% |
| Three or more within 90 days | 11 | 44% |
| Three or more within 180 days | 17 | 68% |
| Three or more within 365 days | 20 | 80% |
| Any within 90 days | 21 | 84% |
| Any within 180 days | 23 | 92% |
| None within 365 days | 2 | 8% |

Median days since latest accepted listing sale: **9.52**, among 23 cards with
accepted sales; the two unavailable cards are excluded from that median.

Newest-sale buckets: 0–30 days 15/25 (60%); 31–90 days 6/25 (24%);
91–180 days 2/25 (8%); 181–365 and 365+ each 0%; no accepted sale 2/25 (8%).
Thus the main problem is often sparse recent depth, not total absence of recent
activity. Unknown metadata must not be interpreted as no upstream sales.

## Hierarchy, confidence and models

The requested Tier 2 and Tier 3 overlap. For a mutually exclusive assignment,
use T1 first, then T3 when 180 days supplies three comps, then T2 for remaining
1–2 recent comps, then T4, then T5. Counts: **T1 11, T2 4, T3 6, T4 2, T5 2**.
Both 90- and 180-day counts remain visible so limited current evidence is never
hidden by an extended-window label.

Current candidate value: 90-day median with 3+; otherwise 180-day median with
3+; otherwise a 1–2-comp 90-day median flagged LOW; otherwise no current value.
Historical-only values are not used for the active-baseline comparison.

Model A: unweighted 90-day item-price median.
Model B: weighted median with TOTAL bucket weights 70% for 0–90 days,
20% for 91–180, 10% for 181–365. Within each bucket split its weight equally;
renormalize over nonempty buckets. Older than 365 never enters the calculation.
These are bucket-total weights, not per-row weights, preventing large old
samples from dominating just because of row count.

Model B changes eight of the 21 available Model A values. There is **no evidence
it improves accuracy**. Dr. Doom Metal moves from $15 to $8.75 despite strong
recent activity; older lower prices can still move the weighted median
substantially. Gambit PowerBlast moves $4.625 to $5.99; Blade stays $42 based
on one recent listing while the 180-day median is $25. Prefer explicit window
medians and transparent sample counts over this blended value.

Provisional confidence:
- HIGH: at least five in 90 days, newest within 30 days, selected high/low <=4.
- MEDIUM: at least three in the selected 90/180-day window, high/low <=8.
- LOW: thinner data, historical-only evidence, or wider price spread.
- UNAVAILABLE: no accepted listing within 365 days.

Counts: **HIGH 2, MEDIUM 13, LOW 8, UNAVAILABLE 2**. This is a conservative,
uncalibrated heuristic, not a probability of correctness. It assumes the existing
reviewed title identity; ambiguous variants are excluded, not upgraded by count.
Every card's assignment appears in the appended table and CSV.

## Outliers, condition and Best Offers

No legitimate sale was automatically discarded for being unusually high or low.
Fivefold departures from each card's 365-day median were flagged for inspection.
The reviewed sample includes Wolverine $231.10 (fixed price), Dr. Doom $173.50
and $94.95 (auctions), and Annual Doctor Doom $0.01 (auction, outside 90 days).
High prices are not necessarily Buy It Now, and low prices are not necessarily
auctions. Titles alone do not prove these prices are accurate.

Sensitivity: excluding prices outside 1/5–5 times the 90-day median leaves the
90-day medians unchanged for Wolverine, Dr. Doom Metal, Gambit PowerBlast and
Doctor Doom Annual. Median handles these extremes adequately without deletion.
This does not protect a 1–2-row sample from distortion.

The earlier reviewed exclusions for grades, lots, breaks, autographs and wrong
parallels remain. No new acceptance loosening. Thor's scratched/VG sale is older
than 365 days. Several Magneto titles say READ; that is a condition warning, not
proof of damage. The 180-day result should not be described as verified near-mint
value without checking those listings.

Best Offer rows: **13 in 30 days; 36 in 90; 42 in 180; 51 in 365** (cumulative,
not additive). These are listing-level aggregates, not independently verified
single accepted transactions. Including offers changes eight 90-day medians.
Five change by more than 10%, relative to the no-offer median:

| Card | With offers | Without | Absolute change |
|---|---:|---:|---:|
| Gambit Flair PowerBlast | $4.625 | $5.25 | 11.9% |
| Colossus X-Fractor | $1.99 | $1.745 | 14.0% |
| Human Torch Spider-Web | $5.49 | $7.875 | 30.3% |
| Doomasaur Purple Shimmer | $19.03 | $13.06 | 45.7% |
| Doctor Doom Neon Blue | $127.50 | $110.00 | 15.9% |

The other changes are Wolverine, Dr. Doom Metal and Magik Mint Green.
No card loses all 90-day rows when offers are excluded. Offers can raise or lower
the median; neither alone is suspicious. The large changes mostly occur in thin
samples. No demonstrated offer-specific arithmetic inconsistency was found;
actual paid amounts remain independently unverified.

## Frozen SoldGraph comparison

Using 3+ 90-day CompsAPI rows versus 3+ frozen SoldGraph usable rows as a simple
coverage screen gives: **CompsAPI clearly better 2, SoldGraph clearly better 2,
similar 9, neither reliable 12**. CompsAPI wins: Colossus and Human Torch.
SoldGraph wins: Blade and Magik Neon Rivals.

These requested category labels are **coverage proxies, not verified reliability
judgments**. SoldGraph is frozen at older capture dates, its full original window
is not established, and some frozen acceptances are known to be questionable.
Iron Man's "similar" count, for example, masks the previously identified
SoldGraph case-break/foil contamination. Per-card counts/medians are preserved
without silently repairing the frozen baseline. No clear provider-wide current
accuracy superiority can be inferred from this 2-versus-2 count.

## Active-estimate sanity check

Difference = absolute(current candidate − active estimate) / active estimate.
Thresholds are nested: **11 above 25%, 6 above 50%, 1 above 100%**.
The appended table lists the exact values, cache dates and flags.

Above 25%: Wolverine, Wedding of Spider-Man, Thunderstrike, Gambit Flair
PowerBlast, Thor PowerBlast, Magneto, Blade, Jean Grey, Colossus, Human Torch,
Iron Man.
Above 50%: Gambit Flair PowerBlast, Thor PowerBlast, Blade, Colossus,
Human Torch, Iron Man.
Above 100%: Iron Man only ($1.99 sold versus $0.60 cached active).

Large cases:
- Colossus $1.99 vs $21.76: three current comps; active estimate may be
  inflated or variant-mixed, but underlying active listings were not saved here.
- Human Torch $5.49 vs $16.99: three current comps and offer sensitivity; thin
  sample and asking/sold difference are plausible, not proof of overpricing.
- Blade $25 extended-window vs $85 active: five 180-day rows but only one
  90-day row; older sales and sample selection matter.
- Gambit $4.625 vs $10.20: eight current rows; asking/sold difference and
  listing mix plausible; cannot certify cause without active listing titles.
- Thor $5.225 vs $3.24: sold is HIGHER, showing active estimates are not always
  overpriced. Its active cache is from June.
- Iron Man $1.99 vs $0.60: three base-title comps; small dollar denominator
  magnifies percentage. No basis to declare the active side wrong solely from it.

Wedding's active cache dates to June 2025; Thunderstrike February 2026;
Magneto January 2026. These are positive cached estimates, not verified current
asking markets. We cannot establish active overpricing, wrong-parallel
contamination or true asking/sold spread from summary caches alone.
Missing or zero active estimates are not assigned a percentage. Historical-only
cards are not assigned a current price merely to make a comparison.

## Production logic IF a later switch is explicitly approved

This is a proposal, not implemented:
1. Request genuine 90-day data with exact identity/parallel safeguards; retain
   full raw rows, query window, units_sold and actual price semantics.
2. Exclude grades, packs/boxes/breaks/lots, wrong variants, explicit damage for
   a near-mint valuation and unresolved identities. Do not infer serials from
   price or accept arbitrary denominators.
3. With 3+ valid recent rows, use item-price median, excluding shipping.
   Show count, oldest/newest date and provisional confidence. Flag wide spreads.
4. Otherwise query/consult at most one bounded 180-day response. With 3+ rows,
   show an explicitly EXTENDED 180-DAY SOLD ESTIMATE, not a strong current value.
5. If only 1–2 rows within 90 days remain, show LIMITED SOLD DATA with individual
   observations/range; do not present an authoritative market value.
6. 365-day rows support historical context only. They never silently supply the
   current-price headline. No recency-blended model is recommended.
7. Accept provider-reported Best Offers with their labels; mixed-unit listing
   averages must be distinguished from single-sale prices. Do not compare
   asking price directly to the returned paid average as proof of error.
8. If no eligible recent sold value, retain the separately labelled existing
   eBay active estimate or unavailable state. Never average the two sources.
9. Ordinary reads use cache; refreshes are bounded, deduplicated and quota-aware.
   Unknown metadata and provider errors never erase a valid legacy cache.

No switch is authorized by this report. Nothing published; production pricing,
provider selection, SoldGraph logic, eBay fallback, catalog, images, mobile,
DINO/Scan to Add, subscriptions and affiliate tracking are unchanged.

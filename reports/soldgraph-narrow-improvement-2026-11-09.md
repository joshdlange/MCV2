# Narrow SoldGraph improvement evaluation

## Recommendation: B — KEEP SELECTIVELY

The changes repair demonstrated implementation errors, but do not establish broad
Marvel usefulness. Only 11/50 cards now reach three usable comps; 32/50 still have
none. The $9/month plan is defensible for a limited, monitored use case, not as a
proven broadly reliable pricing service. Do not interpret this as approval to publish
or a subscription change.

## Same frozen 50-card cohort

| Metric | Frozen before | Matcher replay only | Replay plus three fallback searches |
|---|---:|---:|---:|
| 3+ usable comps | 9 (18%) | 10 (20%) | 11 (22%) |
| 1–2 usable comps | 7 (14%) | 7 (14%) | 7 (14%) |
| Zero usable comps | 34 (68%) | 33 (66%) | 32 (64%) |
| Modelled post-refresh eBay fallback | 21 (42%) | 20 (40%) | 19 (38%) |

Six cards gained usable comps; one lost comps; 43 were unchanged. The one loss is
Jean Grey: two suspected #46-V variant-cover matches are correctly excluded from
the #46 target, reducing nine comps to seven, not changing its coverage tier.

All 19 independently corroborated false identity rejections are fixed. That does
not mean all 19 become usable prices: Best Offer and other exclusions still apply.
Remaining confirmed false rejections from that annotated set: zero. Other
uncertain rejections were not certified as correct.

Before: two suspected false acceptances, not two independently certified errors.
After: both blocked; zero newly identified false positives in review of changed
acceptances and accepted fallback titles. This is not a certified zero-error rate.
Intermediate review found a multi-card Wolverine listing and Canvas variants;
both were blocked before final metrics.

## Changes

- Card-number numeric runs normalize leading zeroes; prefix/suffix identity remains
  significant. FF-23/FF23, PB5/PB-05, AU-11/AU11 and MI-4/MI04 work; bare numbers do
  not substitute for prefixed numbers; 46 does not match 46-V. Spaced title
  separators are distinguished from attached suffixes.
- Exact documented parent season ranges permit their two release years, including
  short and full end years. Slash seasons are not interpreted as serial numbers.
  Unrelated/out-of-range years still reject.
- PowerBlast/Power Blast, apostrophes, punctuation, case and Marvel Comics wording
  normalize. Only 1994 Flair treats Annual/Universe as optional display wording.
  Only 1990/1992 Impel Marvel Universe treats Impel as optional.
  Only 1994 Fleer Masterpieces drops Hildebrandt Brothers marketing wording.
  Existing 2020 Masterpieces manufacturer equivalence remains narrowly scoped;
  no global Upper Deck/SkyBox equivalence was added.
- 2024 Topps Chrome Marvel base Blue Wave derives /150 from its product checklist,
  not from a Blade-specific exception. /99 still rejects. Unknown denominators
  are marked uncertain and withheld rather than assumed contradictory or accepted.
  Source: https://www.tradercracks.com/2024-topps-chrome-marvel-trading-cards-checklist
- Queries remove malformed season fragments and use normalized family wording.
  Live refresh now attempts at most one broader fallback after zero identity
  matches (including zero upstream results), retaining character, number and product.
  Each search separately passes durable quota/budget reservation; collector
  entitlement is charged once. Quota denial or fallback failure retains the primary
  result. Best Offer-only identity matches do not trigger another paid search.
- Existing grade, price, lot and wrong-parallel exclusions remain. Explicit Canvas
  and multi-number SET listings received additional contradiction checks.
- No pricing UI, catalog metadata, images, Scan to Add, DINO, subscriptions,
  affiliate tracking or unrelated pricing changes.

## Three actual fallback searches

The count was reported before execution. Exactly three paid search jobs were
submitted, plus one non-search quota lookup. No retry or bulk job was run.
Three search credits are conservatively accounted for; account billing deltas
were not independently measured.

| Card | Upstream rows | Final usable comps | Recovered? |
|---|---:|---:|---|
| Gambit PB5, 1994 Masterpieces | 44 | 0 | No |
| Scarlet Witch MI-4, 2024 Chrome | 42 | 0 | No |
| Doctor Doom 18, 2021–22 Annual | 58 | 6 | Yes |

Selection was diagnostic, not random: two zero-row prefixed inserts and one
literal season/family query failure. Gambit sales advertise #5, not PB5; the
explicit prefix safeguard intentionally refuses to assume equivalence. Scarlet
Witch results include different subset/parallel identities. These outcomes
demonstrate upstream data, not a license to relax matching.

## Limits of this comparison

The original October diagnostics omit condition and price-range fields for
rejected listings. The offline reconstruction preserves recorded grading/range
rejections, but cannot recover missing raw facts for newly accepted rows. The
after coverage is therefore a diagnostic replay estimate, not a lossless
historical replay or a fresh production UI measurement.

The three November searches preserve complete raw provider pages locally.
They are newer than the baseline and test only three fallback-eligible cards;
do not extrapolate their one-of-three recovery rate across all failures.
No fresh primary searches were run. The revised primary-query performance is
not measured by replaying old primary responses.

Fallback rates above use positive saved legacy caches at an assumed fresh
refresh time. They are not observed UI rates and do not apply the current age
of the old October snapshots.

The evidence proves implementation losses and modest recovery. It still cannot
quantify whether implementation or provider coverage is the dominant cause
across the catalog. A recommendation of broad KEEP would overstate these results;
CANCEL based on claimed absence of Marvel sales would also overstate them.

## Reproduction and verification

Offline commands:

    npx tsx scripts/soldgraph-narrow-replay.ts
    npx tsx scripts/soldgraph-narrow-report.ts
    npx tsx --test server/tests/soldgraph*.test.ts

The separate fallback runner is paid and deliberately does not retry existing
reserved/completed output files. Do not rerun it after deleting those files.
Evidence: generated-artifacts/soldgraph-audit/narrow-final.json and fallback-*.json.
Original baseline.json and original audit results were not modified.

Nothing published. Production code, behavior and database records unchanged.

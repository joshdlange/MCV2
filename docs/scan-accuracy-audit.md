# Scan-to-Add exact-card accuracy audit

## Current evidence and decision

Production aggregate (not independently verified): **2,945 scans**, **2,944 with image URLs**, **2,441 feedback rows**, and **1,036 distinct scans with a selected_card_id**. Development has **zero scans and zero feedback**. Feedback/selection is not independently reviewed photo-to-exact-card ground truth: a selection can reflect user choice or catalog ambiguity, and rows are not necessarily independent scans. There are **zero verified benchmark photos** today. Therefore exact-card top-1/top-3 accuracy, false-high rate, field error rates, uncertainty rates, and latency distributions are **unavailable**, not zero and not inferable from those counts. **STOP recognition tuning and live AI benchmarking until a reviewed manifest exists.** Refine measurement and labeling first; do not publish an accuracy claim.

Request **at least 50, preferably 100** diverse actual collector photos with reviewer-confirmed exact catalog card ID, name, year, main-set family ID/name, card-set (subset) ID/name, checklist number and variation (null for base); include difficult parallels, same-art reprints, uncertain/failed photos and optional card backs. Record independent label evidence and reviewer/date. Check rights and consent before sharing/uploading photos. Keep test fixtures separate from benchmark data.

## Existing pipeline (code as currently implemented)

`server/routes.ts` POST `/api/cards/scan` authenticates, checks free-plan monthly quota (25), logs usage, attempts Cloudinary upload, calls `scanCard`, then persists an upload record with OCR, parsed fields, candidates, confidence and top ID. Feedback endpoint stores `correct`, `wrong` or `not_found` plus optional selected ID. This CLI **does not call either endpoint** or mutate usage, uploads, feedback or ownership.

`server/services/scanService.ts`: Sharp auto-orients, resizes widths under 1000 to 1200 or over 2400 to 2400, normalizes/sharpens and JPEG-encodes at quality 90; processing failure falls back to the original. GPT-4o-mini (`max_tokens: 500`, 10-second timeout, no retries) transcribes the front and optional back into OCR and structured hints; an absent key/API failure returns empty fields. `buildParsedScan` uses structured number/year/set or regex OCR fallback, excluding serial fractions from the checklist number. `scanMatching.ts` normalizes numbers (numeric leading zeros, prefixes), applies known set aliases, extracts keywords and retrieves candidates by selective intersected SQL probes with bounded fallbacks (up to 300 rows per probe, 600 merged, keyword fallback 100). Catalog lookup joins `cards → card_sets → main_sets`.

Candidate score in `scanMatching.ts`: exact normalized number **+50** or conflict **−45**; year **+25/−20**; set alias **+30**, partial words up to **+16**, or conflict **−25**; each distinct subset/variant hint **+20/−25**; full name **+40** or first-word partial **+15**; brand in subset set name **+10**; OCR keywords up to **+12** (4 each). Only positive scores survive, ordered by score then reason count then ID; top five returned. Thresholds: high ≥85, medium ≥45, low >0, otherwise none. High requires exact number plus at least two identity signals, no conflicts, and a set/subset/variant hint; near-ties within 15 points cap high to medium.

The visual pass compares the front to up to three top candidates with usable public HTTPS reference images using GPT-4o-mini (8-second timeout, no retries). Valid strong/weak/mismatch adjustments are **+14/+5/−25**; mismatch caps numeric confidence at 44. A same-name/number/set subset collision without explicit variant evidence caps confidence at 84; previous high ineligibility and near-tie limits remain. Status is `verified`, `uncertain`, `abstained` or `unavailable`; **`verified` is a model comparison status, not externally verified card identity**. Visual failures keep metadata-only matches. Reasons and conflicts in reports are the existing candidate reason strings, not independently validated explanations.

Known limitations: OCR can miss small print, year may be copyright rather than release year, regex number fallback can miss formats, aliases and bounded retrieval may omit the true card, set text is not family identity, variants/parallels can share art, reference images may be missing/wrong/unreachable, and visual comparison can abstain or fail. Crop-tap workflow in `client/src/pages/scan.tsx` crops the front (and optionally back) **before** submitting the image; this CLI measures supplied local photos directly. To assess actual UI accuracy use reviewer-approved exported cropped inputs, and separately document original versus crop conditions; comparing uncropped originals to cropped UI results would confound recognition with user crop behavior.

## Standalone CLI

All paths below are local. Put photos next to a private JSON manifest. Never use production feedback as reviewed labels. Example *schema illustration only* (not a benchmark example, do not count it):

```json
{
  "reviewedBy": "reviewer name",
  "reviewedAt": "2026-01-01T00:00:00Z",
  "scans": [{
    "id": "unique-photo-id",
    "front": "relative/front.jpg",
    "back": "relative/back.jpg",
    "labelReviewed": true,
    "labelEvidence": "How the reviewer confirmed the exact print",
    "expected": {
      "cardId": 123, "name": "Exact catalog name", "year": 2000,
      "mainSetId": 12, "mainSetName": "Exact family name",
      "subsetSetId": 34, "subsetName": "Exact card-set name",
      "cardNumber": "A-1", "variation": null
    },
    "tags": ["glare", "parallel"]
  }]
}
```

`back` and `tags` are optional; all expected fields, review attestation and evidence are mandatory. Values above illustrate structure only and are **not** verified cards. Empty manifests are allowed only for offline reports. Live mode validates identity metadata against the current `cards → card_sets → main_sets` join and checks photo paths before any AI call. A `labelReviewed: true` attests human review; the tool cannot independently certify the review. Do not mark guessed values as reviewed.

Default offline mode (no DB/API import or call):

```sh
npx tsx scripts/scan-accuracy-audit.ts report --input private/saved-results.json --out private/report.json
```

Only after reviewed manifest approval, explicit opt-in live mode (costs OpenAI API calls; requires `OPENAI_API_KEY` and `DATABASE_URL`):

```sh
npx tsx scripts/scan-accuracy-audit.ts run --manifest private/reviewed-manifest.json --out private/saved-results.json --allow-live-ai
npx tsx scripts/scan-accuracy-audit.ts report --input private/saved-results.json --out private/report.json
```

Live mode calls **only existing `scanCard`**, not an HTTP route, and forces PostgreSQL connections read-only with `default_transaction_read_only=on`. It resolves predicted IDs via read-only catalog joins and saves raw scan outputs, label snapshots and total `scanCard` wall time for repeatable offline reporting. Output files use exclusive creation (no overwrite); retain results privately since OCR/photo metadata can be sensitive. Catalog can change after capture: offline reports use saved identity snapshots; re-run with a newly reviewed manifest after migrations. Live calls are sequential, errors reported per scan; there are no stage timers in `scanCard`, so stage latency is explicitly unavailable, not estimated.

Per-scan report includes reviewed expected identity, ranked top/top-3 IDs and joined identities, extracted fields/OCR, visual status, warnings, match reasons/conflicts, top-1/top-3 correctness, false-high flag, field comparison and total latency. Aggregate top-1/top-3 rates use **all reviewed photos as denominator**, failures count as incorrect and are separately counted; false-high means wrong top ID marked `high`, denominator for its rate is all high predictions. Year/family/subset/number error counts distinguish known comparisons from unknown (missing top or unresolved catalog join); subset compares subset set ID **and** variation. Family compares joined `main_sets.id`, **never display set strings**. Empty benchmark rates are `null`. Uncertainty counts no match, confidence levels and visual statuses; neither model confidence nor visual `verified` is ground-truth correctness.

Engineering tests (synthetic-only fixtures): `npx tsx --test scripts/scan-accuracy-audit.test.ts`.

## Hard constraints, visual technology and unresolved ambiguity

Metadata predicates constrain individual SQL probes, not the final candidate pool. Broader probes can admit conflicting candidates. Number/year/set/subset contradictions are **soft penalties**, while the final high-confidence eligibility rules impose a **hard ceiling on the confidence label** when conflicts are recorded. Scores are ranking points, not calibrated probabilities; 98 points does not mean 98% accuracy.

Both image calls use GPT-4o-mini. The visual comparison is a prompted categorical judgment of artwork/composition, not an embedding index, perceptual distance, trained parallel classifier or measured similarity percentage. Its prompt cautions against certifying parallels from foil/color effects. This is safer than asserting exact parallel identity from shared artwork, but it does **not** establish reliable discrimination of border color, foil, pattern, logos or printed-identifier placement. That requested capability remains unproven.

Front and optional back are supplied together in one extraction call. Each requested field has one merged value, without separate front/back provenance or OCR confidence. Consequently there is no reliable-metadata confidence threshold to justify strict exclusion yet. Copyright-year confusion and contradictions between the two sides need real examples before tuning.

## UX and performance audit

After selecting/taking a front photo, the current front-only path adds **two action taps**: “Use front crop”, then “Scan front only”. The crop defaults to a centered rectangle at 90% of the largest fitting 2:3 area; users need not drag it, but must accept it. Whether this default fits most real photos is unmeasured. Adding a back uses an additional photo selection/capture and crop confirmation. Backs remain optional. No UX changes were made in this audit.

The CLI records total recognition wall time, excluding upload/UI cropping. Actual old/new average latency and individual extraction/DB/visual stage durations are **not measured**. Configured 10-second extraction and 8-second comparison timeouts are not observed average latency and are not guarantees for total request duration.

## Recognition results — blocked on reviewed labels

| Requested result | Evidence |
| --- | --- |
| Verified real-photo benchmark size | 0 admitted/reviewed in this audit |
| Exact top-1 / top-3 accuracy | Not measured |
| False HIGH-confidence matches | Not measured, not zero |
| Wrong year / main set / subset-parallel / number | Not measured |
| Correctly admitted uncertainty | Not measured |
| Recognition latency before / now / by stage | Not measured |
| Five representative successes | Not available; no invented cases |
| Five representative failures or ambiguous cases | Not available; no invented cases |

The production image volume is sufficient to **source** a benchmark; the blocker is verification and representative coverage, not proof that photos do not exist. The 1,036 feedback-linked scans are candidates for review, not an independently validated benchmark. Existing photos may eliminate the need for new uploads. Verify 50–100 against exact catalog identities, including the parallel, and check image availability before admission. Only request new photos for missing categories.

The feedback aggregates reinforce why the feedback-type label alone is unsafe as truth: of 892 `correct` feedback rows, 891 have a selected card and **346 select a different card from the stored top prediction**. Of 355 `wrong` rows, 145 have a selected card (72 different from the top prediction). All 1,194 `not_found` rows lack a selected card. These are feedback-row counts, not unique scans or measured recognition errors. A manually corrected selection can be tagged `correct` by the older confirmation flow; never score a benchmark by counting those labels directly.

For a user-supplied set, include same-character/different-product groups, repeated-number/different-product groups, same-art base/parallel groups, chase subsets, imperfect/glare/angled/sleeved photos and missing-reference cases. For every photo provide the exact catalog link or card ID, or full year/product/subset/parallel/checklist number if the ID is unknown. Optional matching backs help reviewers establish difficult identities; they are not required for every scan. Keep the evaluation input as the collector would scan it and record whether it is original or UI-cropped.

**Recommendation: refine further after labeling and measurement; do not publish now.** Retain the current crop and ownership behavior. No evidence currently supports reverting cropping or claiming that the recognition problem is fixed.
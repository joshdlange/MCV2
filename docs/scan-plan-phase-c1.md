# Phase C1 pre-registration: text + visual fusion on the frozen C0 photos

- **Written:** 2026-10-01, after the C0 report (`ee721594`), before any C1 run, OpenAI call or scoring.
- **Status:** committed before running. The C0 FAIL stands as recorded and is not re-scored.
- **Data:** under `MCV_DEV_DATA` (default `.local`, gitignored): inputs in `phase-c0/`, C1 outputs in `phase-c1/`.

**Question:** does combining visual retrieval (C0 arm C) with the existing OCR → metadata matcher
fix the C0 misses? This is one bounded experiment.

**Known before writing:** the C0 per-photo results (visual ranks, causes of misses). Every rule
below is therefore either taken from existing code or fixed without reference to these photos'
outcomes. Where I could not avoid a choice, it is named as a choice.

## 1. Inputs (unchanged from C0)

- **Photos:** batch 1 (`freeze.json`, labels `5b92ff47…`) and batch 2 (`freeze-batch2.json`,
  labels `4edaf97c…`), verified against their hashes before every run.
  - **30 single-card photos** (15 + 15).
  - **36 binder cells** from the 4 batch-1 pages, cut exactly as C0 cut them (C0 §5 geometry).
    `scripts/dev-phase-c1-cells.ts` copies the C0 warp verbatim and writes `phase-c1/cells/` plus
    `cells.json`, hash `9607d1d9…`. The harness checks each cell's hash before using it.
- **Catalog of record:** the frozen production snapshot from 2026-10-01 17:49:53 UTC (C0 Addendum A),
  217,459 cards.
- **Visual index:** C0 I-full (`index.json` `a80794e7…`, `current.f32` `9e75c1d1…`), 90,415 images.
  I-3045 is not used.

## 2. Labels, corrections and leakage

- **Frozen labels are never edited.** `labels.json` and both freezes stay as they are.
- **Corrections** (C0 misses #1 and #2) are decided by the owner in the dev-only, read-only view
  `/admin/phase-c0-photos?review`. That view shows the photo, the frozen label's image and the
  suggested card's image.
  - Confirmed corrections go in a **dated addendum** to this file, committed **before any C1 scoring**.
  - Results are reported **both with and without** the corrections.
- **Leakage exclusion (owner's rule):** a photo or cell is excluded from all scoring and listed
  separately, with its ranks, if its labelled card's catalog image was made from that same photo
  or uploaded by the owner for that card.
  - The view lists every labelled card whose production image is a user upload, as candidates.
  - The owner decides each case, and the decisions go in the same addendum, before scoring.
  - The exclusion applies under each label set. With corrections, it applies to the corrected card.

## 3. Arms (frozen; no tuning on these photos)

| Arm | What runs |
|---|---|
| **T** | The live text pipeline, minus art verification and minus visual retrieval (see below) |
| **V** | C0 arm C, unchanged |
| **F** | T and V concurrently, merged by the rule in §3.1 |
| **F+R** | F, with the rotation rule in §3.2 added on the visual side |

**T in detail.** The harness calls `scanCard(photo, mime, undefined, { visualRetrieval: false, artVerification: false, matchMetadata })`:
- `scanCard` runs the existing EXIF/upscale/normalize/sharpen preprocessing, then
  `identifyCardWithVision` (gpt-4o-mini, the existing prompt, `detail: high`, 10 s timeout, no retries),
  then `buildParsedScan`.
- `matchMetadata` is `matchCandidates`'s exact body (signal check, `retrieveCandidates`,
  `rankScanCandidates`, top 5). The one change is that `retrieveCandidates` gets a `fetchRows`
  bound to a **throwaway local Postgres** loaded from the production snapshot. The SQL conditions,
  probes and scoring are the existing code, unchanged.
- **The local database** lives under `phase-c1/pg`, is started by the harness and holds catalog
  tables only.
  - It is loaded with all 217,459 snapshot cards, including archived ones, because the live matcher
    does not filter archived cards.
  - **One input is missing from the snapshot:** `card_sets.is_insert_subset`, which scoring uses.
    It is read from production in the same read-only transaction as the §7 report, catalog
    metadata only. That read is about 3.5 h after the snapshot; the report states this skew.
    `cards.is_insert` is selected by the matcher but never scored, so it is loaded as false.
- **OpenAI.** Sending the photos is approved by the owner (their own photos).
  - Each photo or cell is sent once, which is 66 calls.
  - **Retry rule:** if the call fails with a transport, 429 or 5xx error (not a model answer), that
    photo is rerun once, and both attempts are reported.
  - Token usage is recorded for every call, and cost is reported at gpt-4o-mini list price
    ($0.15 per 1M input tokens, $0.60 per 1M output). That price is unverified against the account.

**V in detail:**
- **Query:** C0 arm C exactly: the original bytes plus center crops at 0.85 and 0.70, the current
  processor, and the best of 3 per reference, searched over the whole I-full.
- **Sanity check:** on singles, V's ranks must equal C0 `runs.json` arm C / full. Any difference
  stops the run.

### 3.1 Fusion rule (F)

Inputs:
- **V-list:** the visual card ranking (I-full rows expanded to card IDs, ties by lower ID).
  **V-top** = its first K = 10 cards.
- **T-list:** T's top 5 matches, in T's order.
- **Strong text:** a T match whose reasons include both "Exact card number match" and
  "Character/card name matched". Both strings are emitted by the existing `scoreCandidate`.

Fused order, without duplicates:
1. **Agreement:** cards in both V-top and T-list, ordered by visual score.
2. **Strong text:** strong-text T matches not already placed, in T order. This is how a text match
   on name and number is promoted into the shortlist, even when the card has no image or is outside
   the visual top 10.
3. **The rest of V-top,** in visual order.
4. **The rest of T-list,** in T order.
5. **The rest of V-list,** in visual order. This only matters for ranks beyond the top 3.

If T returns nothing, F equals V. If V is unavailable, F equals T. K = 10 and the tier order are
fixed now. Nothing is tried in an alternative variant.

### 3.2 Rotation rule (F+R)

- **Trigger:** V's top-1 score is below **0.85**. That is the existing high-confidence image
  similarity bar in `rerankVisualMatches`, not a value fitted to these photos.
- **When triggered:** the query is also rotated 90°, 180° and 270° (after EXIF rotation).
  - Each rotation gets arm C's 3 crops, so 12 vectors in total.
  - Each reference scores the maximum over all 12. This replaces the V-list, and fusion (§3.1)
    is applied unchanged.
- **When not triggered:** F+R equals F.

## 4. Scoring

Each method gives the rank of the first card in the fused list that it accepts:
- **Exact:** the labelled card ID.
- **Duplicate-corrected:** the labelled card or its duplicate base records, by the C0 §4 rule.
- **Family:** any card with the same `scanFamilyKey` as the labelled card. That key is the existing
  function the product uses for checklist-family alternatives (set alias, year, normalized name,
  card number).
  - It counts same-checklist parallels as correct, because the product shows a version picker.
  - Parallels numbered differently in the catalog are **not** the same family under this rule.

**Metrics:**
- Top-1 and Top-3, plus Top-5 and Top-10 for V, F and F+R.
- Batch 1, batch 2 and combined, with and without label corrections.
- A per-photo rank table.

**Latency.** For each photo, T and the visual side run concurrently in one process:
- T includes preprocessing, OpenAI and the matcher. The visual side includes embedding, search,
  and rotations when triggered.
- **F's end-to-end time** is max(T, V) plus fusion. **F+R's** is max(T, V + R) plus fusion. Both
  are wall-clock times from the same concurrent run.
- T and V are also reported alone. The first query is warm-up and is excluded. p50 and p95 are
  reported.
- The machine is a shared 4-vCPU dev box, and OpenAI latency is the live network.

**Populations:**
- **Findable by either (verdict denominator):** a single counts if V could find it (its card,
  duplicate or family has an I-full image) or T could (its card exists in the snapshot catalog, which
  is every label). In practice that is all 30 singles minus leakage exclusions.
- **No image (the 18 C0 unfindables: 4 singles, 14 cells):** how many T and F find at Top-1 and
  Top-3 by text alone. These would need a text-only result with no picture. They are reported
  separately and are also inside the single-card verdict population.

## 5. Verdict (decided now)

- **PASS** if F **or** F+R, with **family** scoring, on all findable-by-either singles, meets all of:
  Top-3 ≥ 85%, Top-1 ≥ 70%, and end-to-end p95 ≤ 2.5 s.
- **Primary result:** the verdict uses the owner-confirmed corrected labels, with leakage
  excluded. The frozen-label result is reported alongside, and if the two disagree the report
  says so plainly.
- **Binder:** report only.
  - Per-cell Top-1 and Top-3 for each arm under all three scorings.
  - Page time: the C0 warp is re-timed, then the cells are processed with the 9 T calls
    concurrent and the visual work sequential alongside.
  - Patterns by pocket position.
- If F+R passes and F does not, the report says that the rotation rule carried it and that the
  trigger threshold was not validated on separate data.

## 6. Order of work

1. Commit this plan.
2. The owner confirms corrections and leakage in the view, and the addendum is committed.
3. Run the harness (freeze and hash checks, V sanity check against C0, then T, V, F and F+R on
   singles and cells), then score.
4. Write `docs/scan-phase-c1-report.md`, commit it and stop.

## 7. In parallel, read-only: production image-gap list

- **One** `READ ONLY REPEATABLE READ` transaction on the approved production host, which is never
  written to.
- **Output:** the top 500 production cards with no usable image, ranked by `user_collections`
  row count, then distinct collectors, then card ID.
  - "No usable image" means a NULL or empty `front_image_url`, the shared placeholder, a non-http
    URL, or a Google Drive URL: the negation of the image part of `ELIGIBLE`.
  - Only active, unarchived cards in active sets are included.
- **Columns:** card ID, name, number, set, main set, year, why the image is unusable, collection
  rows, distinct collectors. Only aggregate counts are exported; no user IDs or personal data leave
  the query.
- **Same transaction:** `card_sets(id, is_insert_subset)` for the T matcher (§3).
- **Files:** `phase-c1/image-gaps-top500.csv` and `phase-c1/set-flags.json` (gitignored).
  The report summarizes the CSV.

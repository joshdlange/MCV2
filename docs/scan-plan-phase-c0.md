# Phase C0 pre-registration: new photos and full-catalog scale

- **Written:** 2026-10-01, before any Phase C0 photo exists and before any C0 run.
- **Status:** APPROVED and frozen at this commit (2026-10-01), before any C0 photo or arm run.
  Approvals: §5 product PASS judged on duplicate-corrected scores; §6 option 1 (originals); about 2 h of index compute;
  download cap raised to 25 GB after the pilot.
- **Index status at freeze:** manifest frozen (76,998 images, hash `d6cb32bce7e2ec30…`); 1,000-image pilot passed
  (127 s, 0 failures, vectors identical to Phase B on the 43 overlapping images); full run in progress.
- **Photo freeze** (`freeze.json`, §1) still happens after the owner's photos are uploaded and labelled, before any run.
- **Data:** `.local/phase-c0/` (gitignored, never committed).

C0 answers two questions:
1. Does Phase B's direction (3-crop TTA) hold on **new** photos?
2. Does it hold at **full catalog** scale?

## 1. Test photos

- **Source:** the owner's own phone photos, uploaded on the dev-only page `/admin/phase-c0-photos`.
  Development and admin only; the client route is compiled out of production builds.
  Photos are saved byte-for-byte (EXIF kept), with labels, to `.local/phase-c0/labels.json`.
- **Planned set:**
  - About 40 single-card photos. Each is labelled with the correct card ID and condition tags
    (hand, table, sleeve, toploader, glare, binder-neighbors, angle, low-light, clean).
  - 5–10 full 9-pocket pages. Each is labelled with 9 cell card IDs (blank = empty pocket) and the
    4 page corners, which the owner marks on the preview.
- **Freeze:** before any run, the harness writes `freeze.json` with the SHA-256 of `labels.json`
  and of every photo. Results are valid only against that freeze. Adding or relabelling photos
  afterwards means a new freeze and a new, separately reported run.
- **No exclusions,** except one reported group: a photo whose labelled card (and its duplicate base
  records, §4) has no eligible reference in an index is "not findable" in that index. Like scan 2939
  in Phase B, it is listed separately and left out of that index's percentages.
- **No overlap with earlier test photos:** these photos have never been in any index, and the 41
  Phase B cases and the 9-card sample are not used.

## 2. Indexes

| Index | Contents | Reference images |
|---|---|---|
| **I-3045** | The Phase B 3,045-card index, unchanged (hash `45323e43…a23069`) | Full-size originals already on disk |
| **I-full** | Every eligible catalog reference (`ELIGIBLE` in `server/services/catalogVisual.ts`, placeholder excluded): **76,998 distinct images** covering 78,123 card rows in the dev catalog | Per the option approved in §6 |

Owner photos are never added to either index.

## 3. Arms (frozen; no tuning)

| Arm | Query | Embedding | Reference vectors |
|---|---|---|---|
| **A** | original photo | current processor (resize 256, center-crop 224), single image | current |
| **B** | Phase B arm 3, unchanged: original photo + center crops 0.85 and 0.70, best of 3 per reference | crop fix (processor resize/crop off) | crop fix |
| **C** | original photo + center crops 0.85 and 0.70, best of 3 per reference | current processor | current |

- **Each arm runs against both indexes:** 3 arms × 2 indexes.
- **Shared steps:** every arm decodes with EXIF rotation and letterboxes to 224×224 with gray padding.
  No sharpening.
- **"Best of B/C"** is whichever arm has the higher duplicate-corrected Top-3 on I-full single photos,
  then Top-1, then lower p95. The verdict uses that arm, and both are reported.

## 4. Scoring

- **Exact:** rank of the labelled card ID.
- **Duplicate-corrected:** rank of the first card among the labelled card and its duplicate base records.
  - **Rule:** another active record is a duplicate base record if it has the same main set, card
    number, normalized name (alphanumerics only) and normalized variation, **and** both set names
    reduce to empty after normalizing, removing the main-set name, removing years (19xx/20xx) and
    removing "base".
  - **Validated:** applied to Phase B, the rule reproduces exactly the 11 manually classified duplicate
    pairs and credits none of the parallels (Golden Web, ClearChrome, Gold Foil, Promos, Tigra parallels).
  - Every credited pair is listed in the report.
- **Ties:** equal scores break by lower card ID.
- **Metrics:** Top-1/3/5/10 per arm and index, per tag stratum, and a per-photo rank table.
- **ms per query:** decode + crops + embeddings + exact in-memory search (contiguous Float32Array,
  dot product, max over the query's crops), single process. It excludes the first (warm-up) query
  and is measured after indexing has finished, never while indexing runs. Median and p95 reported.

## 5. Verdicts (decided now)

- **Product PASS:** I-full, single-card photos, best of B/C, **duplicate-corrected**:
  Top-3 ≥ 85%, Top-1 ≥ 70%, p95 ≤ 500 ms. Exact-ID results are reported alongside.
  (Duplicate-corrected is used because display-time dedupe is a no-regret change, §8. The owner
  may switch the criterion to exact before the freeze.)
- **Binder:** report only, no pass/fail.
  - **Page geometry:** perspective-warp the marked page quadrilateral to its own aspect, measured as
    the mean of opposite side lengths, with a long side of 2100 px. Real pages have gutters, so the
    pocket grid is often near 8.5×11 rather than 5:7, and the page is never forced to 5:7.
    Split it into 3×3 equal cells and inset each cell by 3% per side to keep pocket seams and
    neighbouring cards out. Then pad each cell with gray to 5:7 (7:5 if wider than tall),
    never stretched.
  - **Arm:** each cell runs through the best-of-B/C arm. The same arm without TTA is also timed and
    scored, report-only, because Phase B showed TTA adds nothing on clean crops.
  - **Reported:** per-cell ranks (exact and duplicate-corrected), Top-1/3 over filled cells, time per
    page (warp + 9 cells, sequential), and empty-pocket handling (top-1 score distribution for empty
    versus filled cells and their separation, e.g. AUC). No empty-pocket threshold is chosen in C0.
  - **Sleeve glare:** cells tagged by the owner's notes, if any, are summarized separately.

## 6. Full-catalog index plan (needs approval before starting)

**What is built:** two vector sets over the 76,998 eligible images, one with the current processor
(arms A, C) and one with the crop fix (arm B). Single-image inference only, the same functions as
Phase B. Output is local files only: `.local/phase-c0/index-full/{current,cropfix}.f32` (contiguous
Float32, 384 per image), `manifest.json` (URL digest → card IDs) and `progress.jsonl`.
**No database writes.**

**Reference download options** (sizes measured on 294 local originals, not estimated):

| | Option 1: originals (recommended) | Option 2: app transform `f_auto,q_auto,w_600,c_limit` |
|---|---|---|
| Mean size | 228 KB | ~34 KB (WebP) |
| Download | **~17 GB** (2,784 of the 3,045-index images already on disk) | **~2.6 GB** |
| Cloudinary transformations | 0 (originals) | up to ~77k new derived images; the share already generated by app browsing is unknown |
| Embedding vs I-3045 | identical preprocessing, so I-3045 vs I-full isolates scale | shifts vectors (cosine to original: median 0.981, p5 0.956, min 0.90), so the 3,045 subset must also be re-embedded from w_600 to separate scale from resolution |

- **Cloudinary impact.** Cloudinary bills in credits; my understanding is that roughly 1 credit ≈ 1 GB of
  delivery or ≈ 1,000 transformations. That puts option 1 at about 17 credits and option 2 at about
  3 credits plus up to about 77, depending on cache. **UNVERIFIED:** check the plan's credit allowance
  and current usage in the Cloudinary dashboard before approving.
  If transformations are cheap or already cached on this plan, option 2 is lighter. Otherwise option 1
  is cheaper and also cleaner for the experiment.
- **Rate limiting.**
  - At most 4 concurrent downloads and 10 requests per second.
  - Exponential backoff on 429/5xx, with 5 attempts per image; failures are logged and skipped.
  - Resumable: completed digests are recorded in `progress.jsonl`.
  - Only catalog URLs; never scan uploads.
- **Wall time on this machine** (4 vCPU, measured at about 85 ms per embedding at 2 ONNX threads):
  - Two variants is about 170 ms per image per process.
  - With 2 worker processes × 2 threads: 76,998 × 0.17 s / 2 ≈ **1.8 h**, with downloads overlapped.
  - **Pilot first:** 1,000 images (about 3 min). Stop automatically and report if the projected total
    exceeds 3 h or the failure rate exceeds 2%.
- **Disk.**
  - Vectors are about 0.24 GB (two variants).
  - Image cache: about 17 GB (option 1) or about 2.6 GB (option 2), kept for re-runs until approved
    for deletion. 247 GB free.
- **Memory:** about 0.3–0.5 GB per worker; the dev server keeps running.
- **Compute approval needed:** about 2 h of indexing, plus about 10 min of query runs. Both are
  above the 5-minute default.

## 7. Order of work

1. The owner uploads and labels photos; I report counts and any labels missing from the dev catalog.
2. Freeze (`freeze.json`); commit this pre-registration if desired.
3. With approval, run the full-index pilot, then the full index.
4. Run all arms × indexes and binder pages, then write the report. Delete the photos only with approval.

## 8. No-regret changes (do regardless; not built yet)

1. **`CardCrop` 2:3 → 5:7** (7:5 landscape). The owner's 41 marked cards measured a median of 0.72.
2. **Feed DINO the original EXIF-rotated photo,** not the OCR-sharpened buffer. Phase B: neutral for
   accuracy, and it saves about 250 ms.
3. **Display-time dedupe of duplicate base records** with the §4 rule (one shared function), plus a
   suspected-duplicates report for later catalog cleanup. 11 of 41 Phase B cards were affected.
4. **Do not ship the crop fix on its own** (Phase B arm 2 was worse than the current processor).
5. **Persist scan timings, top-1 score, margin, tier and the collector's pick** (no photos). Timings
   are returned today but not stored.
6. **Visual index storage and refresh:** contiguous binary vectors and refresh on index change instead
   of re-parsing JSON every 60 s (audit §7.4). This is required before any full-catalog production index.
7. **Upload size:** resize on the client before upload (`main` already caps at 2400 px) and log rejected
   sizes, so the 10 MB cap becomes measurable.

## Addendum A: production is the catalog of record (approved 2026-10-01, before any photo freeze)

**Why:** the dev and production databases have diverged.
- **IDs:** 24,135 card IDs refer to different cards in the two (every ID above 540,000, about 1,690 below 530,000).
- **Images:** production has 93,231 cards with a usable image versus 78,647 in dev.
- **Labels:** the owner's labels are production cards.

Arms (§3), scoring metrics (§4) and verdicts (§5) are **unchanged**. Only the catalog and index
inputs change:

1. **Catalog snapshot.** `scripts/dev-phase-c0-prod-snapshot.ts` takes one read-only transaction on
   production (`ep-lingering-waterfall-a6jtu4k4…/neondb`), catalog metadata only, at 2026-10-01 17:49:53 UTC.
   - Eligible images use the same `ELIGIBLE` SQL: **90,991 images, 92,209 card rows**, manifest hash `ed50c452…`.
   - All **217,459** cards (ID, name, number, variation, set, main set, active/archived, image URL) are
     kept for labels, search and the duplicate rule.
2. **Labels** are production card IDs. The intake page searches and looks up the frozen snapshot file;
   the dev server never connects to production.
3. **I-full = production's eligible images** (`--run=prod`).
   - **Reused vectors:** vectors from the earlier dev-manifest run are reused where the URL matches
     (38,133 images; verified byte-identical on a 300-image trial).
   - **Skipped:** dev-only URLs.
   - **Downloaded:** only images not yet embedded, by the same single-image procedure.
   - **Failures:** HTTP 404 is treated as permanent; such images are reported as missing, not retried.
   - **Download cap:** 35 GB total across both runs (about 22 GB expected).
4. **I-3045 is unchanged** (Phase B images and vectors, dev card IDs). On this index a hit counts
   when the index card's dev identity (normalized name, number, variation and set name) equals the
   labelled card's production identity.
   - The §4 duplicate rule is applied on the production snapshot.
   - 2,988 of 3,045 index IDs are the same card in both databases.
5. **Not findable** (§1) is evaluated against the production snapshot.

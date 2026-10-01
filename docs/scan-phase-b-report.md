# Phase B report: DINO preprocessing and clean-crop arms

- **Date:** 2026-10-01. **Pre-registration:** `docs/scan-plan-phase-b.md` (written before export).
- **Harness:** `scripts/dev-phase-b.ts` (`probe`, `index`, `export`, `run`, `report`).
- **Raw results:** `.local/phase-b/runs.json`, `report.json`, `physical-corrected.json` (gitignored; not committed).
- **Compute used:** about 10 of the 30 approved minutes (index 5.5 min, two arm runs about 2 min each).

## Verdicts (as pre-registered)

| Verdict | Result | Why |
|---|---|---|
| Reproduction gate (arm 0 = 29/32/35 ±1) | **PASS** | 28/31/34 (Top-1/3/10), identical to the earlier 3,045-card rebuild |
| Preprocessing PASS (best of arms 1–3) | **FAIL** | Arm 3 meets Top-1 34 ≥ 32, Top-10 40 ≥ 36 and p95 355 ms ≤ 400, but has **2** Top-1 regressions versus arm 0 (limit 1) |
| Clean crop WORTH BUILDING | **NO** | Best crop arm (5) beats arm 3 by **+2** Top-1 (needs +3); arm 4 by +1 |

Per the pre-registration, preprocessing is not declared a pass and cropping stops as a recognition lever. Nothing below re-scores or re-tunes these 41 cases.

## Results (exact card ID, n = 41)

Scan 2939's confirmed card has no dev reference image, so the ceiling is 40/41 in every arm.
"ms" is query transform + embedding + exact search over 3,045 cards, excluding the first (warm-up) query.

| Arm | Top-1 | Top-3 | Top-5 | Top-10 | ms median / p95 | Top-1 vs arm 0 (gains / losses) | Rank vs arm 0 (better / same / worse) |
|---|---|---|---|---|---|---|---|
| 0 baseline (original photo, current processor) | 28 | 31 | 33 | 34 | 100 / 145 | — | — |
| 0P production sharpened query, current processor | 29 | 31 | 31 | 34 | 345 / 469 | +1 / −0 | 6 / 30 / 5 |
| 1 crop fix, sharpened query | 25 | 29 | 30 | 30 | 351 / 455 | +1 / −4 | 8 / 25 / 8 |
| 2 crop fix, original photo | 26 | 29 | 30 | 32 | 94 / 117 | +1 / −3 | 7 / 27 / 7 |
| **3 arm 2 + 3-crop TTA** | **34** | **40** | **40** | **40** | 316 / 355 | +8 / −2 | 12 / 27 / 2 |
| 4 clean crop (box, 5:7 pad) | 35 | 39 | 39 | 39 | 147 / 173 | +10 / −3 | 11 / 27 / 3 |
| 5 rectified crop (warp to 5:7) | 36 | 38 | 38 | 38 | 456 / 485 | +10 / −2 | 11 / 28 / 2 |
| 6 arm 5 + 3-crop TTA | 36 | 38 | 38 | 38 | 618 / 660 | +10 / −2 | 11 / 28 / 2 |

The arm 5 warp is a pure-JS pixel loop; its time is implementation cost, not inherent. sharp/libvips can warp in a few ms.

### Physical card (same physical card under a different record ID)

The pre-registered physical rule (same main set, number, name and variation) proved too broad.
It also grouped **parallels stored as separate subset sets**: Golden Web vs ClearChrome, Base vs Gold Foil,
Promos, and 45 Tigra #179 parallels for scan 2939. Those are different physical cards.
The table therefore counts only the **11 cases whose group is a true duplicate base record**
(the same base set created twice: sets 7292/12179, 1171/12188, 1183/12180).
`report.json` keeps the original broader metric.

| Arm | 0 | 0P | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|---|
| Top-1 / 3 / 5 / 10 | 30/32/34/35 | 32/32/33/35 | 27/29/31/31 | 28/29/31/33 | **36/40/40/40** | 37/39/39/39 | 38/38/38/38 | 38/38/38/38 |

Duplicate pairs credited: 2813→531102, 2866→531096, 2869→531105, 2871→531100, 2981→530528,
2983→530526, 2984→530527, 3086→530580, 3087→530581, 3090→530567, 3173→530691.
**11 of 41 test cards (27%) have a duplicate base record.** That supports display-time dedupe (Phase C item 6).

### Top-1 by photo type (exact)

Photo-type labels come from the earlier visual review (`dev-strong41-run.ts`); cases can appear in several.

| Photo type | n | 0 | 2 | 3 TTA | 4 box | 5 warp |
|---|---|---|---|---|---|---|
| clean/simple | 5 | 5 | 5 | 4 | 4 | 4 |
| background/hand | 7 | 2 | 2 | 6 | 6 | 6 |
| glare | 16 | 11 | 12 | 14 | 13 | 15 |
| binder/neighbours | 12 | 6 | 4 | 8 | **11** | **11** |
| sleeve/toploader | 20 | 13 | 10 | 15 | 17 | 17 |
| rotation/perspective | 9 | 4 | 3 | 6 | 8 | 8 |

### Per case (exact rank / physical rank under the original rule; x = not in index)

| Scan | Card | 0 | 0P | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|---|---|
| 2790 | 18457 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2813 | 17765 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2823 | 19908 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2824 | 19910 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2825 | 19951 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 1/1 |
| 2826 | 19954 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 20/20 | 20/20 |
| 2835 | 19268 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2836 | 19265 | 1/1 | 1/1 | 2/2 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2838 | 19271 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2866 | 17759 | 4/4 | 10/10 | 41/41 | 8/8 | 2/2 | 1/1 | 1/1 | 1/1 |
| 2869 | 17768 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2871 | 17763 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2899 | 19943 | 5/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2900 | 19944 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 1/1 |
| 2901 | 19945 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2902 | 19946 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2903 | 19947 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2906 | 19950 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2909 | 19957 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2910 | 19959 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2939 | 533958 | x | x | x | x | x | x | x | x |
| 2950 | 15844 | 1/1 | 1/1 | 98/98 | 152/152 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2965 | 17215 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2969 | 19820 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2981 | 20281 | 39/2 | 27/4 | 3/1 | 2/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 2983 | 20279 | 2/1 | 2/1 | 12/12 | 11/11 | 1/1 | 2/1 | 2/1 | 2/1 |
| 2984 | 20280 | 3/1 | 8/1 | 40/40 | 3/3 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3012 | 19270 | 1/1 | 1/1 | 1/1 | 1/1 | 3/3 | 30/30 | 23/23 | 60/60 |
| 3014 | 15590 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3056 | 16844 | 401/401 | 306/306 | 352/352 | 718/718 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3078 | 15845 | 1/1 | 1/1 | 5/5 | 7/7 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3086 | 20327 | 498/103 | 338/91 | 45/4 | 62/4 | 2/1 | 2/1 | 2/1 | 2/1 |
| 3087 | 20329 | 3/2 | 2/1 | 2/1 | 2/1 | 2/1 | 1/1 | 1/1 | 1/1 |
| 3090 | 20330 | 147/147 | 166/163 | 73/73 | 78/78 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3097 | 15626 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3098 | 15647 | 8/8 | 10/10 | 2/2 | 5/5 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3100 | 15634 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3104 | 15623 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3108 | 15640 | 1/1 | 1/1 | 23/23 | 31/31 | 2/2 | 1/1 | 1/1 | 1/1 |
| 3169 | 16868 | 144/144 | 67/67 | 13/13 | 11/11 | 1/1 | 1/1 | 1/1 | 1/1 |
| 3173 | 18232 | 26/26 | 28/28 | 201/201 | 159/159 | 2/2 | 1/1 | 1/1 | 1/1 |

Arm 3's two Top-1 regressions (3012 → 3, 3108 → 2) both stay in the top 3.
Arms 4 and 5 lose 3012 badly (30 and 23), and arm 5 loses 2826 (20). 3012's corners are a clean, near-full-frame
5:7 quadrilateral, so the cause is **not** a marking error; it is UNVERIFIED and was not investigated, to avoid tuning.

## What the numbers say

1. **The audit's "center-crop defect" was wrong about the effect.** Removing the processor's 256→224
   trim (the crop fix) **lowers** raw-photo accuracy: arm 2 is 26/29/32 versus arm 0's 28/31/34.
   The trim works as a 1.14× zoom that cuts background, and that helps cluttered phone photos.
   I retract the recommendation to apply the crop fix on its own.
2. **Zoom is the lever.** The 3-crop TTA (full + 0.85 + 0.70 center crops) is the only large gain:
   +6 Top-1 and +9 Top-3. Its Top-3 is 40/40, every findable case. The gains are concentrated in
   hand/background (2 → 6) and binder (6 → 8) photos.
3. **Sharpening is neutral for DINO** (0P vs 0: +1/−0 Top-1), but it adds about 250 ms per query
   (upscale to 1,200 px wide + normalize + sharpen + JPEG). Feed DINO the original image.
4. **Hand-marked crops add only +1/+2 Top-1 over TTA, and lose Top-3.** They do help most on
   binder/neighbour (11/12 versus 8/12) and sleeve photos. That matters for binder mode, which
   crops by design, but it does not justify building a live camera overlay for accuracy.
5. **TTA on a clean crop adds nothing** (arm 6 = arm 5). Binder cells, already crops, can skip TTA.
6. **Untested combination:** current processor + TTA. Arm 3 combined the crop fix with TTA, and
   finding 1 suggests the current processor might do as well or better. That would be a new arm,
   so it is not evaluated here.

## Important caveats

- **The query photos are Cloudinary-stored copies** (fit 800×1120, EXIF stripped; `server/cloudinary.ts:90`),
  not the original uploads. Production DINO sees the original upload, at higher resolution.
- **`main` already crops every query** (`CardCrop`, 2:3), and the live build does not. These 41
  are uncropped live photos, so after Publish the query distribution changes. Cropped queries plus
  TTA's center zoom may clip card edges. Untested.
- **The 2:3 crop frame is wrong for cards.** Your 41 marked corners have a median short/long aspect
  of **0.72** (5:7 = 0.714; range 0.69–0.78), so a 2:3 frame (0.667) is too narrow for real cards.
- **The 41 are a convenience sample** (29 earlier successes + 12 earlier failures), not representative
  of all scans. Every arm decision above used them, so any follow-up needs fresh cases.
- **Corner order:** the page asked for TL, TR, BR, BL; all 41 were clicked TL, TR, BL, BR (reading order).
  After swapping the last two points, all 41 are convex and clockwise. The as-clicked file is kept
  (`corners.json`); the run used the reordered set (`corners-ordered.json`). This was a page-instruction flaw, not a marking flaw.
  Fixed afterwards: the page now asks for the printed top-left first and then the other three in any order;
  `shared/cardCorners.ts` orders them clockwise and rejects non-convex shapes. The harness now orders
  `corners.json` with the same function, which reproduces `corners-ordered.json` exactly (`shared/cardCorners.test.ts`).

## 10 MB live upload cap

The data cannot show it. The route rejects oversize photos with a 400 **before** any database write
(`user_scan_logs` and `scan_uploads` untouched) and logs nothing. Stored scan photos are resized copies,
so the original size is not recorded either. The live client uploads the raw camera file with no
compression and only shows "Max 10MB". No production query was run because none could answer it.
To measure it: log rejected sizes, or resize on the client (main's crop step already caps at 2400 px).

## Binder page scan

**Reusable function.** One crop in, ranked candidates out, with no OCR, GPT or database writes inside:

```ts
identifyCardCrop(crop: Buffer, opts?: { tta?: boolean; limit?: number })
  → { candidates: { cardId; score; familyKey }[], top1Score, margin, tier, timings }
```

It decodes and EXIF-rotates the original, embeds (single-image, shared ONNX scheduler), runs exact
in-memory search, groups by family and assigns a confidence tier. The single-card route calls it once
(with TTA). The binder route splits the page into 9 cells (5:7, small margin, never stretched), skips
empty pockets, calls it per cell (no TTA, per finding 5), and returns 9 results. Uploads, scan limits,
logging and persistence stay in the routes.

**Estimated latency for 9 cells** (server, one ONNX call at a time on 2 threads; 4 vCPUs available):

| Stage | Per cell | 9 cells | Basis |
|---|---|---|---|
| Embed one cell crop | ~90–150 ms | 0.8–1.4 s | measured: arm 2 94 ms, arm 4 147 ms median (3,045-card search) |
| Exact search, 77k × 384 | ~45 ms | ~0.4 s | measured earlier (synthetic) |
| Split page + empty-pocket check | — | ~50–100 ms | estimate |
| **Total (no TTA)** | | **~1.3–1.9 s** | estimate |
| With TTA per cell | ~450 ms | ~4 s | measured 316 ms + 3 searches; not recommended for cells |

Two ONNX sessions in parallel on 4 vCPUs might halve this. UNMEASURED.

**Is sleeve glare across a full page worth testing? Yes.**
- A 9-pocket page is one PVC sheet, so a single light source tends to make a glare band across
  several cells at once, whereas single-card glare usually covers one region.
- On single cards, glare photos did well with crops (15/16 Top-1 for arm 5), but no page-level data exists.
- Resolution is the second risk. At main's 2400 px crop cap, a cell is about 760 px tall: fine for
  DINO's 224 px input, marginal for OCR. Binder mode should upload the page at ≥ 3000 px long side.
- Proposed bounded test: 5–10 real binder-page photos (45–90 cells), labelled per cell. They need
  collecting first; none exist in the data.

## Capture plan and effort

| Version | Scope | Estimate |
|---|---|---|
| **v1: post-capture guided crop, no native changes** | Fix `cardCrop.ts` to 5:7 (ratio, output size, tests): ~0.5 day. Add 3×3 grid mode: page-shaped frame the user aligns, deterministic 9-cell extraction with margin, empty-pocket skip, multi-result UI with per-cell confirm/fix, per-cell collection add with the cell image attached, batch endpoint: ~4–6 days. | **~1–1.5 weeks** |
| **v2: live camera overlay** | Capacitor camera-preview plugin (native preview behind the WebView; works with the remote `server.url` app) or `getUserMedia`. Either needs the `CAMERA` permission and an Android release; the plugin also needs an iOS project, which does not exist yet. Must handle preview-vs-sensor aspect mapping, cover scaling, orientation and lower-resolution video frames. | **~1.5–2 weeks Android; +1 week iOS** |

Given verdict 2 (cropping is not a big accuracy lever over TTA), v2 is justified only by UX, not accuracy. v1 is cheap and fixes a real 2:3 bug.

## Recommendation (for your decision; nothing built)

1. **Accept the pre-registered FAILs.** Do not ship the crop fix on its own.
2. **Run one confirmatory experiment on fresh cases** before shipping TTA. Use newer production scans with explicit
   collector confirmations (scan ID > 3173, not in the 41 or the 9-card sample), with one more read-only export
   that needs your approval. Run arm 3 exactly as frozen, plus "current processor + TTA" as the single new arm,
   both pre-registered with the same criteria. That separates the TTA effect from the crop fix without tuning on these 41.
3. **Phase C should still design around** "original image to DINO (no sharpen), TTA for single photos, no TTA for
   crops/cells". Do the v1 capture fix (5:7) and plan binder mode on top of `identifyCardCrop`.
4. **Data:** 27% of the test cards have duplicate base records. Make display-time dedupe a Phase C priority.

## Files

- **New (uncommitted, dev-only):**
  - `scripts/dev-phase-b.ts`
  - `server/dev-phase-b-corners.ts` (registered only when `NODE_ENV=development`)
  - `client/src/pages/admin/phase-b-corners.tsx` (route compiled out of production builds)
  - `docs/scan-plan-phase-b.md`, this report
- **Modified (uncommitted):**
  - `server/routes.ts` (+4 lines, dev-only registration)
  - `client/src/App.tsx` (+3 lines, dev-only route)
- **Collector data held for deletion on your approval:**
  - `.local/phase-b/queries/` (41 photos, 4.0 MB)
  - `.local/phase-b/cases.json`
  - `.local/phase-b/corners.json`, `corners-ordered.json`
  - Derived results in `.local/phase-b/runs*.json`, `report.json`
- **Kept:** `.local/phase-b/references/` holds only public catalog images.

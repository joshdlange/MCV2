# Phase C0 report: new photos at full-catalog scale

- **Date:** 2026-10-01
- **Plan:** `docs/scan-plan-phase-c0.md` (incl. Addendum A, production as the catalog of record)
- **Harness:** `scripts/dev-phase-c0.ts` @ `391623ed`, committed before the run
- **Raw outputs:** under `MCV_DEV_DATA/phase-c0` (`.local`, gitignored); hashes at the end

## In plain language

**The pre-registered product check fails.**
- On the full production catalog (90,415 images), the best arm (C: current preprocessing plus
  3-crop TTA) finds the right card first for **14 of 26** findable single-card photos (54%) and in
  the top 3 for **15 of 26** (58%).
- The targets were 70% and 85%. Its p95 time is 572 ms, also over the 500 ms limit.
- Both photo batches fail the same way, and the arm order (C > B > A) holds in each.

Looking at every miss, the model is not the main problem:
- **2 of the 12 misses are labelling errors.**
  - One photo labelled Sentry #79 is actually Spider-Girl #73. Card 548422 means Spider-Girl in dev
    and Sentry in production.
  - One Spider-Man photo was labelled with the wrong Spider-Man card. The model's top-1 is the card
    actually in the photo (score 0.988).
- **3 are the right artwork, wrong parallel** (Base vs Blue Traxx, Clear vs Holo, Cover Variant vs
  Rainbow). The "which version do you have?" step planned for Phase C is built for exactly this.
- **4 are catalog image problems:** the reference is a PSA-slab photo, a COMC-watermarked scan, or
  a near-black scan of a chromium or foil card.
- **3 are photo problems:** heavy glare in a toploader, a card small in the frame, and a card turned
  sideways in a binder page. The pipeline never rotates the query.

Separately, **18 of the 66 cards photographed (27%) cannot be found at all**, because they have no
image in production. That's 4 singles and 14 binder pockets, including a whole page of
*2022 SkyBox Marvel Masterpieces Preliminary Art* and five *Fanfare* cards.

Binder pages work the same way as single photos. Arm C gets 9 of 22 findable pockets right first
(41%) and 13 in the top 3 (59%). Corners are worst, and a page takes about 7 s in total.

**Recommendation:** fix catalog images before building recognition (details in the last section).

## Verdict (pre-registered, §5)

| Criterion (I-full, single photos, best of B/C, duplicate-corrected) | Target | Arm C (selected) | Result |
|---|---|---|---|
| Top-3 | ≥ 85% | 15/26 = **58%** | FAIL |
| Top-1 | ≥ 70% | 14/26 = **54%** | FAIL |
| p95 per query | ≤ 500 ms | **572 ms** | FAIL |

- **Arm selection:** C beat B on duplicate-corrected Top-3 (15 vs 13).
- **Duplicate correction** credited no extra hits in any arm: no photographed card had a duplicate
  base record.
- **Batch agreement:** both batches fail, and the ranking C ≥ B > A holds in each.

| Batch | Arm C Top-1 | Arm C Top-3 |
|---|---|---|
| 1 | 5/12 (42%) | 5/12 (42%) |
| 2 (held-out) | 9/14 (64%) | 10/14 (71%) |

Batch 2 did better despite harder conditions (13 of 15 in sleeves). Batch 1 contains both labelling
errors, two of the three photo-condition misses and one catalog-image miss.

## Single cards

"n findable" leaves out photos whose card has no image in that index (pre-registered §1).

### I-full (production catalog, 90,415 images)

| Batch | Arm | n findable | Exact Top-1/3/5/10 | Dup-corrected Top-1/3/5/10 | ms p50 / p95 |
|---|---|---|---|---|---|
| 1 | A | 12 | 4/4/4/5 | 4/4/4/5 | 209 / 223 |
| 1 | B | 12 | 5/5/5/6 | 5/5/5/6 | 613 / 1220 |
| 1 | C | 12 | 5/5/6/6 | 5/5/6/6 | 492 / 1015 |
| 2 | A | 14 | 4/4/6/6 | 4/4/6/6 | 202 / 260 |
| 2 | B | 14 | 7/8/8/8 | 7/8/8/8 | 466 / 513 |
| 2 | C | 14 | 9/10/10/11 | 9/10/10/11 | 513 / 572 |
| **combined** | A | 26 | 8/8/10/11 | 8/8/10/11 | 209 / 223 |
| **combined** | B | 26 | 12/13/13/14 | 12/13/13/14 | 498 / 651 |
| **combined** | **C** | 26 | **14/15/16/17** | **14/15/16/17** | **506 / 572** |

### I-3045 (Phase B index)

Only **one** photo's card is in the 3,045-card index, so this comparison carries no information.
That photo was a hit at rank 1 for arms A and C, and rank 10 or lower for B.
Timing is lower here only because the search covers 3,045 cards instead of 90,415.

| Arm | Exact / dup Top-1/3/5/10 (n = 1) | ms p50 / p95 |
|---|---|---|
| A | 1/1/1/1 | 89 / 108 |
| B | 0/0/0/1 | 338 / 420 |
| C | 1/1/1/1 | 348 / 393 |

### By condition (arm C, I-full, findable singles; photos can carry several tags)

| Tag | Top-1 | Top-3 |
|---|---|---|
| sleeve | 10/16 | 11/16 |
| glare | 10/16 | 11/16 |
| binder-neighbors | 7/11 | 8/11 |
| toploader | 2/6 | 2/6 |
| clean | 2/4 | 2/4 |
| angle | 1/4 | 1/4 |
| hand | 1/3 | 1/3 |
| table | 0/2 | 0/2 |
| low-light | 0/1 | 0/1 |

## Every single-card miss (arm C, I-full)

Ranks are duplicate-corrected. Exact ranks are the same, since no duplicates applied.

| # | Batch | Labelled card | Tags | Rank C (B / A) | Top-1 instead | Best read of why |
|---|---|---|---|---|---|---|
| 1 | 1 | 548422 Sentry #79 | hand | 522 (496 / 1083) | Captain Marvel #94 (same Topps Mint set) | **Label error:** the photo is **Spider-Girl #73** (production 548416), which dev numbers 548422. Post-hoc, the actual card ranks 19th, so still a miss: holo card in hand. |
| 2 | 1 | 521312 Spider-Man #PMR-TI-01 (Kakawow) | clean, low-light | 13 (62 / 33) | 533722 Spider-Man #MRA01 Base | **Label error:** the photo shows Spider-Man #MRA01. The model's top-1 is that card (score 0.988, margin 0.20). |
| 3 | 1 | 48188 Magneto #164 Base | table, sleeve | 14 (22 / 51) | 50184 Magneto #164 Blue Traxx | **Same-art parallel:** identical artwork, different foil. |
| 4 | 1 | 101774 Enchantress #WI32 Cover Variant | table, toploader, glare | 4 (10 / 528) | 51144 Enchantress #VI33 Cover Variant Rainbow | **Same-art parallel.** The numbers (WI32 vs VI33) also look like a catalog inconsistency worth checking. |
| 5 | 1 | 101839 She-Hulk #WI97 Cover Variant | toploader, glare | 6720 (1805 / 6542) | Black Widow #89 | **Photo condition:** strong glare in the toploader. The colours in the photo also differ from the reference, so it may be a different colour variant. |
| 6 | 1 | 42243 Sabretooth #FG-42 | clean | 3009 (1471 / 7035) | Storm #65 (reference is a phone photo in a stand) | **Catalog image:** the reference is a blurry COMC-watermarked scan, while a phone-photo reference of another card in the same kind of stand matched better. |
| 7 | 1 | 101781 Gamora #WI39 Cover Variant | hand, toploader, angle, glare | 169 (1167 / 2056) | Blink #48 (reference is a PSA-slab photo) | **Photo condition:** card small in the frame, hand and toploader. Background-heavy references attract it. |
| 8 | 2 | 55770 Bullseye #19 Clear | sleeve, glare, binder-neighbors | 2 (15 / 2949) | 56310 Bullseye #19 Holo | **Same-art parallel.** |
| 9 | 2 | 18765 Juggernaut #11 Chromium | sleeve, binder-neighbors | 10 (3 / 1554) | Synch #37 Chromium | **Catalog image:** the reference is a very dark scan of a chromium card, while the photo is bright. |
| 10 | 2 | 305962 Star-Lord (Marvel Preview #15) | sleeve, binder-neighbors, angle, glare | 127 (**1** / 418) | Knull #128 | **Catalog image + photo:** the reference is a near-black foil scan, and the photo has glare and neighbouring cards. Arm B ranked it 1st. |
| 11 | 2 | 18699 Rogue #42 Flair Annual | sleeve, toploader, binder-neighbors | 8565 (5215 / 2197) | Mariko #84 | **Catalog image:** the reference is a photo of a PSA slab (label, case and grey surround). |
| 12 | 2 | 75493 Captain America #PB6 Power Blast | angle, glare, sleeve | 15749 (11716 / 24013) | Marrow #23 | **Photo condition: rotation.** A landscape card sits sideways in the binder page and nothing rotates it. Glare too. |

**Summary of causes:** 2 label errors · 3 same-art parallels · 4 catalog images · 3 photo
conditions (1 of them rotation).

If the 2 label errors are corrected and same-art parallels count at the family level, arm C would
be at about 17/24 Top-1 (71%). **This is not the verdict;** it is shown only to size the causes.

## Binder pages (report-only)

- **4 pages, 36 pockets, all filled.** No empty pocket exists, so empty-pocket separation could not
  be measured.
- **14 pockets are not findable** (no production image): all 9 on page 1 (*2022 SkyBox Marvel
  Masterpieces Preliminary Art*) and 5 on page 2 (*Fanfare*).

| Over 22 findable pockets | Top-1 | Top-3 |
|---|---|---|
| Arm C (with TTA) | 9 (41%) | 13 (59%) |
| Same arm without TTA | 8 (36%) | 14 (64%) |

| Pocket position | n | C Top-1 | C Top-3 |
|---|---|---|---|
| Centre | 2 | 2 | 2 |
| Edge | 10 | 4 | 6 |
| Corner | 10 | 3 | 5 |

- **Time per page:** about 7.2 s with TTA and about 4.9 s without, on this 4-vCPU machine.
  - About 3.3 s of that is the page warp, which is an unoptimized JavaScript pixel loop.
  - The 9 cells take about 4 s with TTA (about 0.45 s each) and about 1.6 s without (about 0.18 s each).
- **Pattern 1, same-set confusion:**
  - On the *Topps Mint* base page the right card was usually ranks 2–7, behind another card from
    the **same set**. That set's large shared frame outweighs the small artwork.
  - Two misses ranked 2nd behind another record with the same name and number (Ironheart #58,
    Jeff the Land Shark #60). These are likely parallels of the same card; not visually verified.
- **Pattern 2, corners:** corners did worst.
  - Glare across the sleeve, and the corner pockets being furthest from the camera, are the likely
    causes. Not separately verified.
  - Sleeve glare across a full page is real (pages 2–4), and it is worth fixing on capture.

## Not findable: image-cleanup candidates

- **Single photos:** 244906 Wolverine vs. Captain America #GB-14 · 289832 Hawkeye #M-18 ·
  332230 Heimdall #37 · 58403 Daredevil #12-V.
- **Binder pockets:**
  - All of *2022 SkyBox Marvel Masterpieces Preliminary Art* photographed: 44170, 44153, 44158,
    44099, 44104, 44157, 44124, 44134, 44167.
  - *Fanfare*: 543119, 543100, 543072, 543073, 543080.
- **Catalog images that failed to download during indexing:** 576 (494 missing/404, 82 corrupt
  JPEGs). Listed in `phase-c0/index-prod/failed-images.json`.

## Caveats

- **The sample is small:** 26 findable single photos, so each photo moves a percentage by about 4
  points. Two of the 26 are labelling errors, kept as frozen labels, not corrected.
- **Timing** is single-process JavaScript on a shared 4-vCPU dev machine, during the run. Batch 1's
  p95 (about 1.0–1.2 s) comes from a few slow queries, not investigated. Full-catalog search is a
  plain JS loop over 90,415 × 384 floats per crop and is not optimized.
- **The labelling errors show the dev/production ID problem reached the data.** The first photo was
  labelled before the intake page switched to production. Addendum A fixed the intake for later
  photos.

## Recommendation (one)

**Fix catalog images before building recognition.** Of the misses and gaps found:

| Cause | Photos or pockets | How it would be fixed |
|---|---|---|
| Not findable: no production image | 18 (27% of cards photographed) | A cleaner catalog |
| Wrong kind of reference image | 4 misses | A cleaner catalog |
| Same-art parallels | 3 | The planned "which version?" step, not more model work |

Concretely, before any further recognition work:
1. Run the Phase D cleanup on whole sets with no images (starting with those above).
2. Replace slab, watermarked and near-black foil references.
3. Check the 576 failed images.

Then collect a fresh frozen photo batch and rerun these exact arms. Rotation handling for sideways
cards is the one model-side gap found; it would need its own pre-registered arm.

## Provenance and hashes

| Item | Value |
|---|---|
| Production catalog snapshot | 2026-10-01 17:49:53 UTC, manifest `ed50c45274126382…`, 90,991 eligible images |
| I-full | `index.json` `a80794e7…`, `current.f32` `9e75c1d1…`, `cropfix.f32` `cff4c314…`; 90,415 rows, 576 missing |
| I-full verification | 5,534 Phase B images max Δ 1.5e-8; 20 re-embeds max Δ 7.4e-9; 0 bad norms |
| Batch 1 freeze | 2026-10-01 18:38 UTC, labels `5b92ff4768502afa…`, 19 photos (15 singles, 4 pages) |
| Batch 2 freeze | 2026-10-01 19:06 UTC, labels `4edaf97c83542de3…`, 15 singles |
| Run output | `phase-c0/results/runs.json` sha256 `299319143b66e68170838c65f9e132b14e03e5008a1c180a5f38bd009404e055` (harness @ `391623ed`) |
| Downloads | 19.8 GB in total across both index runs (cap 35 GB); image cache deleted after verification |

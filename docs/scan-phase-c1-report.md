# Phase C1 report: text + visual fusion on the frozen C0 photos

- **Date:** 2026-10-01
- **Plan:** `docs/scan-plan-phase-c1.md` (`b508dfe9`), Addendum A (`1bf02c37`), both committed before the run
- **Harness:** `scripts/dev-phase-c1.ts`. Raw outputs are under `MCV_DEV_DATA/phase-c1` (gitignored); hashes at the end.
- **Labels are not owner-confirmed** (Addendum A). The headline uses my suggested corrections with
  every leakage candidate excluded, as a proxy. All four combinations are reported, and they agree.

## In plain language

**C1 fails, and fusion makes results worse than visual search alone.**
- The best fused arm (F+R) finds the right card or its version family first for **13 of 27**
  photos (48%) and in the top 3 for **15 of 27** (56%). The targets were 70% and 85%.
- Visual search alone (V) gets **15 of 27** at both Top-1 and Top-3.
- End-to-end p95 is **3.9 s** against the 2.5 s limit. The OCR call on its own takes about 2.4 s
  (median), so this arm cannot meet the limit whatever the matcher does.

**Why the text side does not help:**
- **The card number usually isn't on the front.** OCR returned a number for only 10 of 30 photos.
- **When it did return a number, the number was usually wrong.** On cover-variant and
  "renditions" cards, OCR read the printed comic cover ("Journey Into Mystery #103",
  "Strange Tales #100", "#1"). All **6** of T's top-1 answers that matched on number and name were
  wrong cards. The fusion rule promotes exactly that kind of match, so it pushed wrong cards to
  the top.
- **Without a number, the matcher picks old cards with the same name.** It cannot tell sets apart.
  "Masterpieces '92 Platinum" is read as year 1992, so the 1992 SkyBox originals outrank the 2024
  cards in the photos.
- **T alone** gets 1 of 27 Top-1 (family scoring, headline combination). For the 18 cards with no
  catalog image, text found **1** (White Widow #FF-48).

**What did help:**
- **Rotation.** The sideways Captain America Power Blast went from rank 15,749 to **1**, and
  Spider-Girl went from 19 to 9.
- **Family scoring.** Counting a card's other versions as correct (as the version picker would)
  fixes 3 of V's misses: Magneto, Bullseye and Juggernaut.

**Leakage looks real, but isn't confirmed.**
- The 3 single photos whose catalog image was uploaded by user 337 score 0.988–0.992 visually, the
  highest in the set. Correct top answers elsewhere score 0.71–0.89.
- On binder page `d2223f95`, whose images were uploaded by user 2078, 8 of 9 pockets rank 1. The
  other pages manage 3 of 13 pockets that have an image.
- Both patterns are what a photo matching itself would look like.

**Recommendation:** don't build fusion on the current OCR matcher; carry forward only the rotation
finding, and keep the C0 priority of fixing catalog images (last section).

## Verdict (pre-registered §5, Addendum A)

PASS requires F or F+R, **family** scoring, all findable-by-either singles: Top-3 ≥ 85%,
Top-1 ≥ 70%, p95 end to end ≤ 2.5 s.

| Labels / leakage | n | F Top-1 | F Top-3 | F+R Top-1 | F+R Top-3 | p95 (F and F+R) | Result |
|---|---|---|---|---|---|---|---|
| **Suggested / all candidates excluded (headline proxy)** | 27 | 12 (44%) | 14 (52%) | 13 (48%) | 15 (56%) | 3.88 s | **FAIL** |
| Suggested / none excluded | 30 | 15 (50%) | 17 (57%) | 16 (53%) | 18 (60%) | 3.88 s | FAIL |
| Frozen / all candidates excluded | 28 | 12 (43%) | 14 (50%) | 13 (46%) | 15 (54%) | 3.88 s | FAIL |
| Frozen / none excluded | 30 | 14 (47%) | 16 (53%) | 15 (50%) | 17 (57%) | 3.88 s | FAIL |

- **All four combinations fail all three criteria,** so the result does not depend on the
  unconfirmed labels or on the leakage decisions.
- **Excluded as leakage candidates:**
  - Suggested labels: `3b12ef57`, `e119dfef`, `a4254afa` (user 337).
  - Frozen labels: the frozen 521312 image isn't a user upload, so only `e119dfef` and `a4254afa`.
- **Batch agreement (headline combination):** both batches fail.
  - Batch 1 (n = 12): F+R 3/3, V 4/4.
  - Batch 2 (n = 15): F+R 10/12, V 11/11.
  - In both batches V is at least as good as F at Top-1. F+R edges V at Top-3 only in batch 2.

## Singles (headline combination: suggested labels, leakage candidates excluded)

Top-1/3 for T; Top-1/3/5/10 for V, F and F+R. T returns at most 5 candidates.

| Batch | n | Scoring | T | V | F | F+R |
|---|---|---|---|---|---|---|
| 1 | 12 | exact | 0/0 | 3/3/4/4 | 2/2/2/4 | 2/2/2/5 |
| 1 | 12 | family | 0/0 | 4/4/5/5 | 3/3/3/5 | 3/3/3/6 |
| 2 | 15 | exact | 1/2 | 9/10/10/11 | 7/9/10/11 | 8/10/11/12 |
| 2 | 15 | family | 1/2 | 11/11/11/12 | 9/11/11/12 | 10/12/12/13 |
| **combined** | 27 | exact | 1/2 | 12/13/14/15 | 9/11/12/15 | 10/12/13/17 |
| **combined** | 27 | **family** | 1/2 | **15/15/16/17** | 12/14/14/17 | **13/15/15/19** |

- **Duplicate-corrected** scores equal exact scores everywhere: no labelled card has a duplicate
  base record.
- **Other combinations,** combined, family Top-1/3:

| Combination | n | T | V | F | F+R |
|---|---|---|---|---|---|
| Suggested / none | 30 | 4/5 | 18/18 | 15/17 | 16/18 |
| Frozen / none | 30 | 3/4 | 17/17 | 14/16 | 15/17 |
| Frozen / all candidates | 28 | 1/2 | 15/15 | 12/14 | 13/15 |

**Where fusion changed the family Top-1 relative to V** (all 30 photos, suggested labels):

| Arm | Better than V | Worse than V |
|---|---|---|
| F | 1 photo: Juggernaut, where agreement lifted rank 10 to 1 | 4 photos (see below) |
| F+R | 2 photos: Juggernaut, and Captain America via rotation | the same 4 |

The four photos made worse:
- **Venom #20 and Thanos #CB-11:** a "strong text" match on a wrong number was promoted to the top.
- **Electro #23 and Johnny Blaze #2-V:** "agreement" lifted a 1992 original or another set's
  card that happened to be in V's top 10 above the right card.

**The rotation rule** triggered on **19 of 30** singles and **29 of 36** cells. The 0.85 trigger
fires on most photos.

### Latency (singles; first query excluded as warm-up; T and visual run concurrently)

| | p50 | p95 |
|---|---|---|
| T (preprocessing + OpenAI + matcher) | 2.79 s | 3.88 s |
| — of which the OpenAI call | about 2.4 s | about 3.2 s |
| V (arm C) | 0.66 s | 0.95 s |
| V + rotation, when triggered | 2.49 s | 2.89 s |
| **F end to end** | **2.79 s** | **3.88 s** |
| **F+R end to end** | **2.79 s** | **3.88 s** |

- **T bounds F and F+R;** the rotation work finishes inside T's time.
- **The matcher's SQL** ran against a local Postgres loaded from the production snapshot, so
  production's database latency is not measured. That part takes a median 0.08 s of T (max 0.39 s).

## Every single-card photo (family ranks, suggested labels; – = not found)

T lists at most 5 candidates. V, F and F+R rank the whole catalog.

| Photo | B | Labelled card (suggested in brackets) | OCR read | T | V | F | F+R | Note |
|---|---|---|---|---|---|---|---|---|
| 19627bee | 1 | 548422 → [548416 Spider-Girl #73] | SPIDER-GIRL · topps | – | 19 | 24 | 9 |  |
| 55f980bf | 1 | 548433 Doctor Strange #90 | DOCTOR STRANGE · topps | – | 1 | 1 | 1 |  |
| 320022d3 | 1 | 48188 Magneto #164 | MAGNETO · #1 · HOUSE OF X (2019) · 2019 | – | 1 | 1 | 1 |  |
| a11a894e | 1 | 101774 Enchantress #WI32 | Thor · #103 · Journey Into Mystery · 2023 | – | 4 | 9 | 9 |  |
| 98961465 | 1 | 244906 Wolverine vs. Captain America #GB-14 | #91 | – | – | – | – |  |
| d0941992 | 1 | 101839 She-Hulk #WI97 | SHE HULK · #1 · MARVEL Platinum | – | 473 | 478 | 553 |  |
| 0366c7c0 | 1 | 289832 Hawkeye #M-18 | VENOM · #1 · MARVEL | – | – | – | – |  |
| f1568c19 | 1 | 42243 Sabretooth #FG-42 | SABRETOOTH · X-MEN | – | 3,009 | 3,014 | 3,358 |  |
| dccc362d | 1 | 101781 Gamora #WI39 | Wolverine · #100 · Strange Tales | – | 169 | 174 | 205 |  |
| e5c9a393 | 1 | 66898 Vulture #14 | SPIDER-MAN · #128 · The Amazing Spider-Man · 1981 | – | 1 | 1 | 1 |  |
| 3b12ef57 | 1 | 521312 → [533722 Spider-Man #MRA01] | SPIDER-MAN · RIVALS · 2026 | 1 | 1 | 1 | 1 | leak candidate (user 337) |
| d870c444 | 1 | 332230 Heimdall #37 | Marvel Continuum | – | 20 | 20 | 20 |  |
| e119dfef | 1 | 533140 Madame Hydra #19 | MADAME HYDRA · topps | 1 | 1 | 1 | 1 | leak candidate (user 337) |
| a4254afa | 1 | 20821 Black Cat #56 | Black Cat · Spider-Man Premium | 1 | 1 | 1 | 1 | leak candidate (user 337) |
| 3c67bfb4 | 1 | 66905 Venom #20 | VENOM · #1 | – | 1 | 6 | 6 |  |
| d3252c8d | 2 | 75101 Kraven #26 | Kraven · Marvel | – | 1 | 1 | 1 |  |
| d273e2b7 | 2 | 75076 Wolverine #1 | Wolverine · FLAIR MARVEL | – | 1 | 1 | 1 |  |
| 29b9729f | 2 | 75493 Captain America #PB6 | CAPTAIN AMERICA · Fleer Marvel | – | 15,749 | 15,754 | 1 |  |
| ac04239c | 2 | 19953 Spiderman VS Scorpion #3 | SPIDER-MAN | – | 1 | 1 | 1 |  |
| cedb97f3 | 2 | 18699 Rogue #42 | Rogue · Flair Marvel Annual · 1995 | 1 | 8,565 | 11 | 11 |  |
| 5ea9a846 | 2 | 18715 The Shrieking #57 | Spider-Man · Fleer Marvel Annual | – | 1 | 1 | 1 |  |
| 10f4e73b | 2 | 18765 Juggernaut #11 | JUGGERNAUT · MARVEL ANNUAL | 2 | 10 | 1 | 1 |  |
| 8af904a9 | 2 | 55861 Thanos #CB-11 | THANOS · #4 · MARVEL MASTERPIECES '92 PLATINUM | – | 1 | 6 | 6 |  |
| 73b567aa | 2 | 56922 Black Widow #3 | BLACK WIDOW · MARVEL MASTERPIECES '92 PLATINUM | – | 1 | 1 | 1 |  |
| a2a6cd8d | 2 | 56333 Black Panther #4 | BLACK PANTHER · MARVEL MASTERPIECES · 1992 | – | 1 | 1 | 1 |  |
| b1d0ccb1 | 2 | 305962 Marvel Preview (1975) #15 #FC-7 | STAR-LORD · MARVEL MASTERPIECES '92 PLATINUM | – | 127 | 132 | 112 |  |
| a5078117 | 2 | 56515 Electro #23 | ELECTRO · MARVEL MASTERPIECES · 1992 | – | 1 | 2 | 2 |  |
| 22efdd5a | 2 | 55770 Bullseye #19 | BULLSEYE · MARVEL MASTERPIECES '92 · 1992 | 5 | 1 | 1 | 1 |  |
| 4cef8797 | 2 | 58403 Daredevil #12-V | Daredevil · MARVEL MASTERPIECES '92 PLATINUM · 1992 | – | 1 | 1 | 1 |  |
| 34b8ed5e | 2 | 58411 Johnny Blaze #2-V | GHOST RIDER & BLAZE · #29 · MARVEL MASTERPIECES · 1992 | – | 1 | 2 | 2 |  |

**Notes on photos that matter for the verdict:**
- **She-Hulk, Gamora and Enchantress** are *cover variant* cards. OCR read the comic cover
  (MARVEL Platinum #1, Strange Tales #100, Journey Into Mystery #103), and T confidently returned
  those comics' cards from other sets.
- **Rogue #42:** T was correct at rank 1. F placed it 11th, because fusion only ranks T's
  non-"strong" matches after V's top 10, and the C0 slab-photo reference kept V far away.
  This is the one case where a different tier order would have helped. The rule was fixed in
  advance and was not changed.
- **No catalog image and no family image (Wolverine vs. Captain America #GB-14, Hawkeye #M-18):**
  every arm misses. OCR also misread both (#91, and VENOM #1).

## Cards with no catalog image (the 18 C0 unfindables)

| Group | n | T Top-1 / Top-3 (exact) | F Top-1 / Top-3 (family) |
|---|---|---|---|
| Single photos | 4 | 0 / 0 | 1 / 1 (Daredevil #12-V, via another card in its family that has an image) |
| Binder pockets | 14 | 1 / 1 (White Widow #FF-48) | 0 / 0 |

- **Text is not a workaround for missing images on these cards.**
- **The SkyBox Preliminary Art page:** OCR returned no name and no number for any of its 9 pockets.
- **The Fanfare pockets:** OCR read the name but never the number.

## Binder pages (report only; frozen labels; family Top-1 / Top-3)

| Pockets | n | T | V | F | F+R |
|---|---|---|---|---|---|
| With a catalog image | 22 | 1 / 2 | 11 / 13 | 12 / 14 | 12 / 14 |
| … excluding leakage candidates (page `d2223f95` and the Knull pocket) | 12 | 1 / 1 | 3 / 5 | 3 / 5 | 3 / 5 |
| No catalog image | 14 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |

**By pocket position** (with an image; family Top-1 / Top-3):

| Position | n | V | F |
|---|---|---|---|
| Centre | 2 | 2 / 2 | 2 / 2 |
| Edge | 10 | 6 / 6 | 7 / 7 |
| Corner | 10 | 3 / 5 | 3 / 5 |

Corners remain the weakest, as in C0.

**Page time:** 18.7–24.2 s per page.
- **What it includes:** the warp, 9 concurrent OpenAI calls, and the visual side with rotation
  (rotation triggered on 29 of 36 cells), run in sequence alongside the OpenAI calls.
- **The warp** took 4.6–5.0 s, against 3.1 s in C0. The machine was under more load.

**Fusion on cells:**
- **Helped:** Knull (V 7 → F 1) and the Fanfare White Widow (no image; T rank 1). White Widow
  still only reaches 11 in F, because non-strong T matches come after V's top 10.
- **Hurt:** nothing at Top-3.

## Cost

| Item | Value |
|---|---|
| OpenAI calls | 66 (30 singles + 36 cells), 0 errors, 0 retries |
| Tokens | 2,144,316 input and 6,262 output, about 32,500 input per call with `detail: high` |
| Cost | **about $0.33** at gpt-4o-mini list price ($0.15 / $0.60 per 1M tokens), unverified against the account |

The cost is an upper bound: some calls reported cached input tokens, which usually bill lower.
At this rate, one live scan is about half a cent.

## Production image-gap list (read-only, for the cleanup track)

- **The query:** one `READ ONLY REPEATABLE READ` transaction on production at 2026-10-01 21:32:51 UTC.
- **Output:** `phase-c1/image-gaps-top500.csv` (gitignored), ranked by collection rows, then
  collectors, then card ID. It contains no user IDs.
- **Active cards with no usable image: 115,097** (111,761 with none at all, 3,336 with the
  placeholder). No active card has a Google Drive or non-http URL.
- **The top 500:** 1,702 collection rows between them; every card is in at least one collection.
  The most-collected card has 13 rows, and the 500th has 2. The ranking is shallow, so sets are a
  better unit of work than single cards:

| Main set · set | Cards in the top 500 | Collection rows |
|---|---|---|
| 1992 Comic Images Punisher Guts & Gunpowder | 85 | 268 |
| 2026 Topps Chrome Sapphire Edition · Base | 82 | 262 |
| 1996 Fleer Marvel Amalgam | 68 | 182 |
| 2026 Topps Chrome Marvel Comics · Fanfare, RayWave Refractor, Refractor, The Beyond, Meanwhile, Marvel Icons… | 109 | more than 380 |
| 1984 FTCC Marvel Superheroes First Issue Covers | 40 | 120 |
| 2008 Upper Deck Marvel Masterpieces Set 2 | 39 | 78 |

- **The same read** also took `card_sets.is_insert_subset` (5,800 sets) for the matcher. It was
  read 3 h 43 min after the catalog snapshot, and every snapshot set had a value.

## Caveats

- **Labels and leakage are unconfirmed.** Every combination fails, so confirming them cannot
  change the verdict, only the exact percentages.
- **Small sample:** 27–30 photos, so one photo moves a percentage by about 3.5 points.
- **One OCR pass per photo** at the live default temperature. A second pass could read differently.
  No retries were needed.
- **The matcher ran against a local copy** of the production catalog (all 217,459 cards, including
  archived ones, as the live matcher sees them). `cards.is_insert` was loaded as false; it is
  selected but never scored.
- **Timing** comes from a shared 4-vCPU dev machine and the live OpenAI network.

## Recommendation (one)

**Do not build fusion on the current OCR → metadata matcher.**
- **Why:** it is wrong far more often than right on these photos. It can't meet the latency limit
  either, because the OCR call alone takes about 2.4 s.
- **Carry forward rotation only:** it is the one C1 change that rescued a miss. It needs its own
  pre-registered test, with a trigger threshold set on separate photos, because 0.85 fired on
  about two-thirds of queries.
- **The C0 priority still stands:** fix catalog images first. That means sets with no images
  (the top-500 list above), plus slab, watermarked and dark-foil references.
- **Also check the leakage candidates.** Visual results on user-uploaded references may be
  overstated if those uploads are the same photos.

## Provenance and hashes

| Item | Value |
|---|---|
| Freezes | batch 1 labels `5b92ff47…`, batch 2 labels `4edaf97c…`; all 34 photo hashes verified at run start |
| Cells | `cells.json` `9607d1d9…` (C0 warp, verified per cell during the run) |
| V sanity check | V's exact and dup ranks equal C0 arm C / full for all 30 singles (asserted) |
| Index | I-full `index.json` `a80794e7…`, `current.f32` `9e75c1d1…` |
| Raw output | `phase-c1/results/raw.json` sha256 `b4adb2cfabdde8cd8630330e8db9a6b8e34f80b0e344b008b517f4203a14714d` |
| Scores | `phase-c1/results/scores.json` sha256 `a1c9b3dd09ee50dad75c50cfd0f9ede161db722ac18b3a4b0ec67e80623a50c6` |
| OCR model | gpt-4o-mini-2024-07-18 |
| Harness version | Run at 21:38 UTC from the working tree on top of `1bf02c37`, so the harness was **not** committed before the run (the plan was). Replit's auto-commit `141536e7` (21:44) captured the same file. The only later change, in `c7804627`, is a score-output field rename. |

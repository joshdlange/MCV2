# Phase B pre-registration: DINO preprocessing and clean-crop arms

Written 2026-10-01 before any of the 41 query photos were exported or viewed.
Harness: `scripts/dev-phase-b.ts`. Data: `.local/phase-b/` (gitignored, never committed).

## Fixed inputs

- **Cases:** the frozen 41 scan IDs and confirmed card IDs from
  `attached_assets/dev-broad-readonly-production-results.json` `perCase`.
  Never the original 9-card sample.
- **Model:** `dinov2-small:c2bb04a…:q8:cls`, bundled offline (`dist/models`), single-image path only.
- **Index:** 3,045 cards, rebuilt with the `dev-strong41-run.ts` recipe. The rebuilt
  (id, digest) list hashes to `45323e43…a23069`, identical to the strong41 index.
  Card 533958 (scan 2939's positive) has no usable dev reference, so scan 2939
  cannot be an exact hit in any arm. Same index for every arm.
- **Ranking:** cosine over every index card (cards sharing an image tie; ties
  break by lower card ID, as in strong41). TTA scores a card by its best match
  over the query's crops.

## Arms

The historical baselines (29/32/35 and the 28/31/34 rebuild) embedded the
**original** photo. Production instead feeds DINO the OCR-sharpened buffer
(`normalize().sharpen()`, JPEG q90). Arms 0 and 0P separate the two.

| Arm | Query input | Embedding |
|---|---|---|
| 0 | original photo | production (processor resizes to 256, center-crops 224) |
| 0P | production sharpened buffer | production |
| 1 | production sharpened buffer | crop fix (processor resize and crop off; 224 letterbox reaches the model whole) |
| 2 | original photo | crop fix |
| 3 | original photo + center crops at 0.85 and 0.70 of each side | crop fix, best of 3 |
| 4 | clean crop: axis-aligned box around the 4 marked corners, turned upright by the nearest 90° implied by the marked top edge, padded with gray to 5:7 (7:5 for landscape cards), never stretched | crop fix |
| 5 | rectified crop: perspective warp of the marked quadrilateral to 500×700 (700×500 for landscape cards) | crop fix |
| 6 | the better of arm 4 or 5 (by Top-1, then Top-10, then arm 5) + the 3-crop TTA of arm 3 | crop fix, best of 3 |

The crop fix is checked by a probe: a red band in rows 0–9 of a 224×224 input
reaches the model unchanged. With both processor flags left at their defaults,
the harness pipeline reproduces production vectors exactly (max |Δ| = 0 on 5 references).

Corners are marked by the owner on the dev-only page `/admin/phase-b-corners`,
in printed-card order TL, TR, BR, BL, in normalized coordinates of the
EXIF-rotated photo. No automatic detection.

## Scoring

- Top-1/3/5/10 and ms per query (query transform + embedding + full search).
- Per case: rank in each arm, and improved/unchanged/worsened versus arm 0.
- **Exact:** rank of the confirmed card ID.
- **Physical:** rank of the first card in the confirmed card's physical group: the
  known duplicate pairs 20279/530526 and 20280/530527, plus any active record with
  the same main set, card number, name and variation. Every group is listed.

## Verdicts (decided before running)

- **Gate:** arm 0 must reproduce 29/32/35 ±1 on each of Top-1/3/10 (exact). Otherwise stop.
- **Preprocessing PASS:** the best of arms 1–3 has Top-1 ≥ 32/41, Top-10 ≥ 36/41,
  at most 1 Top-1 regression versus arm 0, and ≤ 400 ms per query.
- **Clean crop WORTH BUILDING:** arm 4 or 5 beats the best of arms 1–3 by at least
  +3 Top-1, with at most 1 Top-1 regression versus that arm. Otherwise stop pursuing cropping.
- No tuning beyond these arms. Exact-ID metrics decide verdicts; physical metrics are reported alongside.

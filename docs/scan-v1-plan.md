# Scan to Add v1: plan

- **Status:** PLAN ONLY (2026-10-01). Waiting for the owner's OK. Nothing is built or published.
- **Where:** dev only, behind `SCAN_VISUAL_RETRIEVAL` (off in production).
- **No OCR in the critical path.** C1 showed it is slow (about 2.4 s) and usually wrong on these cards.

## The flow

1. **Capture.** The existing scan page, with three changes:
   - **Crop shape:** the `CardCrop` frame changes from 2:3 to **5:7** (7:5 landscape).
   - **Client resize:** the phone shrinks the photo to a 1600 px long side before upload, so
     uploads are small and fast.
   - **Auto-rotate:** if the top score is below 0.85, the server also tries the card turned 90° and
     270°. Sideways is the failure C1 actually saw; 180° is left out to save time. That costs
     about +1.3 s on the scans that trigger it. 0.85 fired on about two-thirds of C1 photos, so the
     log (step 6) will tell us where to set it.
2. **Match.** Arm C (photo + two center crops) over the production picture index, held in
   memory.
   - **No single-crop variant:** in C0 it found 8 of 26 versus 14 of 26 for arm C, so accuracy does
     not hold.
   - **Results:** the top 5, **grouped by version family** using the existing family key, and
     each family shows its picture.
   - **Version picker:** tapping a family opens "Which version do you have?" with its parallels.
3. **"Not here?"** opens a fast search (name, number or set), using the existing card search, and
   the collector picks the card.
4. **Gap fill.** If the chosen card has no usable picture, the app asks "Use your photo as this
   card's image?".
   - **Approval:** a yes uses the existing submit → admin approval path.
   - **Indexing:** on approval, that one image is embedded and added to the index.
   - **Photo storage:** the scan photo is uploaded **only** when the collector says yes. Today
     every scan photo goes to Cloudinary; v1 stops that.
   - **Trusted uploaders:** admins and trusted uploaders skip the queue today, so for them
     approval is immediate.
5. **Confirm → add to collection** (existing).
6. **Log every scan, with no photo:**
   - top score, margin, rotation used or not;
   - what the collector picked, and its rank in our list (or "searched");
   - whether gap fill was used;
   - timings.

   This is a new small table. The existing `scan_uploads` table stores photo URLs and OCR text, and
   v1 does not write to it. **This log becomes the real accuracy number.**

## Prerequisites

- **A. Refresh the dev catalog from production** (the backlog procedure): dev only, one read-only
  production transaction, catalog tables only, back up dev first.
  - **Your call before it runs:** clear or remap dev test rows that point at old card IDs
    (collections, wishlists, scans, pending images).
  - **Why it's needed:** without it, dev card IDs don't match the index or production.
- **B. The production picture index.**
  - **Reuse C0's vectors:** 90,415 images, verified. They are saved as one binary file (about
    140 MB), keyed by image URL and content digest, and loaded into memory at startup.
  - **Today's index** keeps vectors as JSON in the database and re-reads them every 60 s, which is
    too slow at 90k.
  - **New and changed images** are embedded one at a time when saved (approval, admin upload).
    There are no catalog-wide batch jobs.
  - **Getting the file into production** is a production change and needs its own OK at deploy
    time: either ship it with the build, or put it in object storage.
- **C. Hosting for a fast first scan.**
  - **Autoscale,** which we use today, can scale to zero, so a first scan may wait for the model and
    the 140 MB index to load (seconds, not measured yet).
  - **A Reserved VM** stays warm, with about 0.5 GB of memory for the index and model.
  - **To do:** measure cold start on autoscale in dev and compare prices (I haven't checked
    Replit's current pricing). The recommendation follows from those numbers.

## Effort (working days, dev only)

| Item | Days |
|---|---|
| A. Dev catalog refresh (script, backup and restore, verify) | 1–1.5 |
| B. Index file, loader, embed on save, removal of the 60 s re-read | 2–3 |
| C. Cold-start measurement and hosting recommendation | 0.5 |
| 1. 5:7 crop, client resize, auto-rotate | 1 |
| 2. In-memory arm C, family grouping, version picker | 2–3 |
| 3. "Not here?" search | 0.5–1 |
| 4. Gap fill (opt-in upload, approval, embed one) | 1–1.5 |
| 5–6. Confirm wiring, scan log table and endpoint | 1 |
| Tests and dev QA on the owner's phone | 1.5–2 |
| **Total** | **about 11–15** |

## Not in v1

- No OCR, back photos or GPT artwork check in the scan path.
- No binder pages.
- No production deploy or production data change without a separate OK.

## Open questions for the owner

1. The dev test rows in prerequisite A: clear or remap?
2. The rotation trigger: start at 0.85 with 90°/270° only, as proposed, or something else?

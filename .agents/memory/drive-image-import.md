---
name: Drive image import safety pattern
description: Rules approved for the Drive → Cloudinary card image importer and its idempotency ledger
---
- Front/back rule (user-approved): with exactly 2 images, a filename marked FRONT/BACK wins its side and the unmarked file is the opposite side. Sort order alone is NOT an approved basis — never use it without explicit new approval.
- **Why:** Alphabetical order put BACK files first in real data; wrong proposals were caught in review.
- Idempotency lives in the `drive_image_imports` ledger: unchanged Drive file ids are skipped on rerun. Card URL update + ledger row must commit in one transaction, or resumability reporting drifts.
- Real import always re-scans Drive fresh (never trusts a stale dry-run report) and card URLs are swapped only AFTER Cloudinary confirms upload — same pattern as the COMC migration.
- Card images are never overwritten. The final card update must atomically require that the target side is still empty, so a concurrent update between scan and upload is preserved.
- Incremental sync uses a Drive Changes cursor. Capture a baseline token before a full crawl, persist it only from the safe completion path, and force a recovery full audit when a change cannot be resolved to a top-level set.
- A set checkpoint may become complete only after all eligible work for that set is processed without failures. Read-only scans never write checkpoints; after interruption, redoing some scan work is acceptable, but skipping pending images is not.
- **Why:** A prematurely advanced cursor can permanently hide changes, and a scan-time “complete” checkpoint can strand images if the process dies before upload.
- **How to apply:** Any future importer/backfill touching card images should follow: fresh/targeted safe scan → strict eligibility gates → upload → atomic empty-only card swap + ledger → checkpoint → cursor.

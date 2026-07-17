---
name: Drive image import safety pattern
description: Rules approved for the Drive → Cloudinary card image importer and its idempotency ledger
---
- Front/back rule (user-approved): with exactly 2 images, a filename marked FRONT/BACK wins its side and the unmarked file is the opposite side. Sort order alone is NOT an approved basis — never use it without explicit new approval.
- **Why:** Alphabetical order put BACK files first in real data; wrong proposals were caught in review.
- Idempotency lives in the `drive_image_imports` ledger: unchanged Drive file ids are skipped on rerun. Card URL update + ledger row must commit in one transaction, or resumability reporting drifts.
- Real import always re-scans Drive fresh (never trusts a stale dry-run report) and card URLs are swapped only AFTER Cloudinary confirms upload — same pattern as the COMC migration.
- **How to apply:** Any future importer/backfill touching card images should follow: fresh scan → strict eligibility gates → upload-then-swap → transactional ledger.

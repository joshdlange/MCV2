---
name: External image migration pipeline
description: How externally-hosted card images move to Cloudinary and what must never regress
---

- One pipeline only: the continuous worker in the image-migration service (advisory-locked, paced, resumable — worklist derived live from cards table, so restart-safe). The old COMC nightly cron and the no-op image-processor were removed; do not reintroduce parallel migrators.
- COMC (img.comc.com) 403-blocks server downloads (Cloudflare, July 2026) but Cloudinary's remote fetch is NOT blocked — always upload external URLs by handing the URL to Cloudinary, never fetch server-side.
- PriceCharting images come in sizes .../<size>.jpg; try 1600 → 500 before the stored (usually 240) size for sharper copies.
- **Clearing a card image to NULL is destructive**: only definitive dead-URL failures (404/410/not found/invalid image) increment the permanent-attempt counter (3 strikes, 6h cooldown between). Timeouts/5xx/rate-limits must never count, or an outage erases healthy URLs. Ledger table: image_migration_failures (also the "what got cleared" report).
- Set imports must re-host images on Cloudinary inline (placeholder on failure) — never store external URLs at import time.

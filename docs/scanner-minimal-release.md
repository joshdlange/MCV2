# Minimal scanner release

## Switch
`SCAN_VISUAL_RETRIEVAL=on` enables Scan to Add and Rapid Scan for all authenticated users, subject to existing plan limits. Any other value selects the original scanner. This is a server environment switch; it takes effect when the running server receives the changed environment and restarts. It is not an in-page instantaneous remote switch.

`RUN_SUPERFRACTOR_DUPLICATE_REPAIR` remains unset/off. Only the exact value `true` permits that destructive maintenance seed.

## Packaged assets
`runtime/scanner` contains only six index/model files plus SHA-256 hashes. The model is pinned DINOv2-small quantized ONNX. The existing 90,415 vectors are reused. No scan photos, experiments, Python dependencies, or development database are required at runtime. Build failure is fatal on checksum or offline-inference failure.

## Exact database setup
Production metadata inspection confirmed these five tables and their required columns already exist. No existing table or column is altered. If a table is absent, startup creates it with `CREATE TABLE IF NOT EXISTS` under an advisory-locked transaction:

- `user_scan_logs`: `id`, `user_id`, `created_at`.
- `dev_scan_events`: `id`, `user_id`, `status`, `top_score`, `margin`, `picked_card_id`, `used_search`, `photo_submit_used`, `total_ms`, `server_ms`, `ranked_card_ids`, `created_at`.
- `dev_scan_reference_overrides`: `card_id`, `image_url`, `model_version`, `embedding`, `updated_at`.
- `catalog_visual_references`: `key`, `model_version`, `reference_url`, `content_digest`, `embedding`, `status`, `attempts`, `last_error`, `retry_at`, `updated_at`.
- `pending_card_images`: `id`, `user_id`, `card_id`, `front_image_url`, `back_image_url`, `status`, `source`, `rejection_reason`, `reviewed_by`, `reviewed_at`, `created_at`.

The exact SQL, types, constraints and defaults are in `server/scanSchema.ts`. The historical `dev_` table prefixes are retained to avoid migrations or copying data; they now use the application's normal database pool in either environment.

Image reports and submitted photos reuse `pending_card_images`; approved image vectors use `dev_scan_reference_overrides`. No separate image-version table is required by these paths. Undo uses short-lived signed capabilities verified against the owned row, not an in-memory map or a new table.

No `db:push` or destructive schema synchronization is part of this release.
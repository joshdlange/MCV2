# Scan v1 dev handoff

Steps 2–5 implemented, 2026-10-01 (Central). Never published; no production writes.
The normal development workflow is running with `SCAN_VISUAL_RETRIEVAL=on`.
The strict development/non-deployment gate keeps the legacy production path unchanged.

## Checkpoints
- Before step 2: `scan-v1-before-step2-20261002`
- Before step 3: `scan-v1-before-step3-20261002`
- Before step 4: `scan-v1-before-step4-20261002`
- Before step 5: `scan-v1-before-step5-20261002`

## Delivered
- Frozen C0 arm C index loaded once at startup; bundled offline model, original plus
  85%/70% crops, five distinct families and explicit version selection.
- Flagged 5:7/7:5 crop, existing search selection fallback and confirm/add flow.
- No OCR or inferred rotation. Scan photos remain in memory. Only explicit review
  opt-in uploads the retained crop through the existing submission endpoint, after
  successful collection save; upload failure does not undo ownership.
- Separate dev-only scalar telemetry records score, margin, selected card, search,
  actual photo submission attempt and browser upload-to-painted-results duration.
  No photos, filenames, OCR, URLs or request bodies are stored in that telemetry.
- No index rebuild, automatic photo indexing or hosting study.

## Evidence and limits
- Step 2 service/model/snapshot tests: 20 passed, one optional existing test skipped.
- Final focused route, telemetry, crop and save-order tests: 52 passed.
- Frozen-index fixture matches recorded C0 top card and score.
- Browser fixture imports the real scan page and sends real multipart bytes through
  the isolated dev route and real frozen inference. Auth, collection, search and photo
  storage are mocked; it is not proof of a live signed-in phone session.
- Controlled local upload-to-painted-results: first measured **1.838 seconds**;
  repeat **0.567 seconds**. Initialization and token acquisition excluded.
  Actual phone/network timing is displayed for each scan; do not call these phone timings.
- Browser checks: five families, version selection, manual search, empty response,
  unchecked photo default, explicit upload, upload failure with ownership preserved,
  reset and UUID telemetry. Zero unexpected APIs or page errors.
- Evidence retained under `.local/scan-v1/qa/`; final run:
  `2026-10-02T01-22-12-164Z-89a167a1-c152-471d-bd91-b33d139ba0fa`.
- Live config returns `visualV1:true`; unauthenticated scan returns 401; public mobile
  screenshot shows normal sign-in. Real signed-in UI remains unverified.
- Rechecked all catalog IDs/full-row hashes against step-1 snapshot after startup:
  482 main sets, 5,800 card sets, 217,459 cards; unchanged.
- Corrected a pre-existing missing space in the dev photo-review heading that blocked
  Vite dependency scanning after package refresh.
- No project-wide clean TypeScript claim: repository has no root tsconfig.

Keep every retained `.local/` file and step-1 backup. See `scan-v1-step1.md` for restore
evidence. Golden Anniversary investigation has not been started.
# Isolated scan phone UI captures

## DEV Rapid Scan

Run `npx tsx --tsconfig client/tsconfig.json client/scan-qa/capture-rapid.ts`.
Run pure contract/policy tests with
`npx tsx --tsconfig client/tsconfig.json --test client/src/lib/rapidScan.test.ts`.
The real Scan page, mobile header, reusable review grid, selection tile and
photo/report actions are production-built **only under `client/scan-qa/build/rapid`**.
Auth is replaced at isolated build time, all APIs run on an ephemeral loopback
mock server, and the camera is a labeled 640×480 canvas stream. Remote catalog
requests are blocked; existing cached photography is decorative only. Synthetic
QA catalog choices explicitly say QA. This is not model accuracy or real-phone
acceptance. No live ownership, production writes, OCR, model changes, HMR,
publishing, app-auth bypass, or main workflow restart.

390×844 viewport captures plus full-page companions and request/assertion evidence
are in `client/scan-qa/screenshots/rapid/`. Scenarios cover live/tray, unselected
suggestions, review, same-art multi-set/parallel choice collapsed and expanded,
dedup, partial Add all / retry, success, safe partial Undo / retry, post-save
manual-search-only optional photo consent / failure / retry, wrong-image reporting
with and without independently attached photos, retained-batch permission fallback,
picker, unavailable camera, autoplay rejection, background interruption requiring
explicit retry, late permission/unmount, removal/stale recognition, queue 9 /
session 18, legacy gating and unchanged single-photo picker. The fake frame has
three colored corner markers; multipart JPEG dimensions and markers are checked
to prove no crop. Each new row's returned token is required for Undo; preexisting
rows are explicitly prohibited in the mock DELETE handler.

`RapidCaptureInput` in `client/src/lib/rapidScan.ts` is the camera-independent
producer contract: one transient `File`, source and optional stable producer
item key per item. Future pocket producers must resize their full item image
before enqueueing (5MB per item ceiling). `useRapidScan` owns bounded recognition
and session state; `RapidReviewGrid` only consumes item state/callbacks. No rapid
photos, thumbnails or choices are saved to local/session storage. Removed and
exited item object URLs are revoked. Recognition is serialized; interrupted
in-flight requests are **not** replayed automatically because they may already
have consumed a scan. Camera tracks stop on review, exit, background and unmount.

Green is a **UI strong-match heuristic**, never calibrated confidence:
score ≥ .85, margin ≥ .07, and exactly one top-family catalog option / set.
Multiple versions or sets always require an explicit choice. Suggested identities
remain visible while unresolved and never become Add all candidates.
Real rear-camera permission, iOS autoplay/device behavior, scan accuracy,
hardware latency, and real authenticated ownership remain unverified.

## DEV idle banner

Run `npx tsx client/scan-qa/capture-idle.ts`. This production-builds the actual
Scan page with the actual MobileHeader and isolated build-time auth aliases.
All APIs, collection count and ownership are mocked; the three thumbnails use
existing cached catalog photography, not live ownership. There is no live auth
bypass, DB access, HMR or main workflow restart. Output stays under
`client/scan-qa/screenshots/idle/`.

Captures: 390×844, 390×844 with 47px top / 34px bottom safe areas, and 1280×844.
Checks include aspect ratio/no crop, no document overflow, 56px capture action,
existing capture/search handlers, owned-only latest-three ordering, empty/error
collection states, usage limit, legacy isolation, PNG fallback and an image-decode
check for a missing clean asset returning SPA HTML. A synthetic flat image tests
late clean-file discovery and headline visibility; it is not the supplied artwork.

Run `SCAN_QA_FIXTURE=path/to/export.json npx tsx client/scan-qa/capture.ts`.

To create the requested real DEV export:
`NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on npx tsx client/scan-qa/export-fixture.ts`.
This uses the guarded backend browse/search functions and ranks the actual frozen
Darkhawk #16483 reference vector through `DevScanVisualService.rankVectors`.
It does **not** call the startup initializer that creates reference tables. The
export includes locally cached real catalog image URLs; unavailable images remain
explicit fallbacks. Exported JSON, downloaded images, and build output are ignored
by git; `.local` is never modified.

The harness builds **saved before** and current workspace sources independently,
without HMR or restarting the main workflow. It serves only ephemeral loopback
fixture apps. Auth aliases apply **only to these isolated builds**, never shipped
application sources. All APIs are intercepted and no database is accessed.
Screenshots and evidence are saved to `screenshots/scan-phone/`.

The backend owner should export a JSON fixture with:

- `source`: catalog export provenance, e.g. DEV export timestamp.
- `families`: up to five real scan families, with the first family's options
  spanning at least two main sets or years. Include a parallel in the last set
  when available. Each card includes `mainSetId`, `setId`, `mainSetName`.
- `margin`: the scan's existing score margin.
- `browseHint`: `{year, mainSetId, setId, setName}`.
- `years`: existing picker response `number[]`.
- `sets`: map of year to picker sets with `totalCards`.
- `subsets`: map of `"mainSetId:year"` to picker subsets.
- `cards`: map of set ID to picker cards.
- `search`: map of query to search response; include `"darkhawk 11 1992"`.
- `images` (optional): map of catalog image URL to local exported image path.
  Remote requests are blocked; without local images the UI shows its no-photo
  fallback, not invented/repeated artwork.

Captures cover same-art results, year, set, subset, card, and typed token search
at 390×844. Assertions cover five families, no set preselection, explicit set-row
add, parallel chip selection without add, exact card mutation, quick next, Undo,
report dialog, no implicit upload, no horizontal overflow, and no JS errors.

These are **fixture UI checks**, not authenticated real-phone acceptance, a
recognition accuracy test, or a real add/Undo backend test.
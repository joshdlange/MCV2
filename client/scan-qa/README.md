# Isolated scan phone UI captures

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
# DEV visual-v1 phone scan

Only `/api/cards/scan/config` with `visualV1: true` activates this workspace.
The legacy flow is unchanged. No binder scanning is included.

## Artwork decision

Artwork family scores are cosine similarities, not probabilities. A top-two
margin below **0.035**, or a missing margin with multiple candidates, shows the
top **two** artworks side by side on phones. Otherwise only the top artwork is
shown. This is a conservative UX threshold, not calibrated recognition accuracy.
Both decision codes (`artwork_ambiguous`, `artwork_preselected`) are logged with
the fixed threshold and number of displayed artworks through the DEV categorical
client-event route. The server also records top score, actual margin and ranked
card IDs in the scan event.

The first artwork's `representativeCardId` is preselected even if a different
version occurs first in `options`. Version changes are inline; each artwork has
its own Add button. Recognition never causes collection writes.

## Adds, repeat capture and Undo

`POST /api/cards/scan/collection` returns `{created, ownedRow, undoToken}`.
It inserts with conflict-do-nothing. Existing owned rows, quantities, notes and
other metadata are never altered. Existing ownership receives an Already owned
notification without an Undo action.

New rows receive a server-side, user-scoped Undo capability with a two-minute
expiry. `DELETE /api/cards/scan/collection/:ownedRowId` requires that capability.
Under a row lock it compares the entire new-row snapshot before deleting. A
changed or missing row is left untouched; a card ID is never used as a row ID.
Capabilities are intentionally in-memory and invalidated by server restart.
XP uses the normal farm-proof card-added ledger; Undo does not remove XP events,
matching normal collection deletion. Feed milestones, badge checks and stats
invalidation follow normal collection actions.

After an add, the page resets and attempts camera input immediately. If the
browser blocks asynchronous opening, the large Scan next card control remains.
Only an added search/browse choice without a usable catalog image interrupts
repeat capture for an optional photo offer. Its reduced full-frame photo remains
until submission, Skip, or explicit reset. Crop is optional review-only.

## Guided lookup and typed search

Not here opens Year → Set → Subset → Card using the existing picker APIs and
Browse Cards' `SetThumbnail` component. The server's top-ten common-set
`browseHint` starts in that checklist. Breadcrumbs and Back change context.

The DEV search API permits one-character card-number queries and gives exact
numbers priority. It selects matching parent-set/year/name/number families,
then expands sibling checklists so matching a parallel cannot exclude its base.
True base checklists are classified with the same name conventions as Browse
Cards (parent name, repeated parent name, Base, Base Set). Base sorts ahead of
parallels before the final result limit; client grouping uses the parent-set ID,
not alphabetically adjacent subset names. Versions are collapsed behind +N.
Archived/inactive cards, sets and parent main sets cannot be selected or added.

## Verification

`NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on npx tsx scripts/test-scan-phone-production.ts`
builds isolated production assets under `.local/scan-v1/qa`, uses test-only auth,
runs five real full-frame inference requests, and intercepts collection/review
APIs. It never modifies actual ownership. It covers one-tap Add, representative
preselection, ambiguous alternatives, inline variants, repeat capture, safe Undo,
existing ownership, context navigation, single-digit search, true-base grouping,
post-add image offer, optional crop, small-screen layout and no HMR resources.

`npx tsx --test server/tests/dev-scan-ux.test.ts` covers Undo snapshot safety and
flag-off rejection before database access.
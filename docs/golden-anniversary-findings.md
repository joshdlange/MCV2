# Golden Anniversary: read-only findings

Owner confirmed proceeding after the Scan v1 pause question. No catalog writes,
application changes, Scan implementation, workflow restarts, or publishing were
performed. The supplied checklist is the owner's expected identity reference.

## Production evidence

Read-only production queries identify main set **432**:
**2025 Topps Marvel Comic Book Heroes 1975 Golden Anniversary**,
slug `2025-topps-marvel-comic-book-heroes-1975-golden-anniversary`.
The parent and all listed subsets are active and unarchived.

| Subset ID | Subset | Stored total | Actual rows |
|---|---|---:|---:|
| 6711 | Base | 100 | 100 |
| 6712 | Black & Gold | 100 | 100 |
| 6722 | Electrum | 100 | 100 |
| 6723 | Gold | 100 | 100 |
| 6724 | Gold Atomic | 100 | 100 |
| 6725 | Gold Flake Shimmer | 100 | 100 |
| 6726 | Gold Mini-Diamonds | 100 | 100 |
| 6727 | Gold Raywave | 100 | 100 |
| 6728 | Purple & Gold Lava | 100 | 100 |
| 6729 | Red & Gold | 100 | 100 |
| 6730 | Refractor | 100 | 100 |
| 6731 | Rose Gold | 100 | 100 |
| 6732 | SuperFractor | 100 | 100 |

Each has exactly the supplied #1–100, with zero name mismatches. Each lacks
all 50 supplied numbers #101–150. Counts include archived rows; none of these
subsets has archived cards hiding the missing numbers.

Searching every card under parent 432 for #136, #148, Rocket, or Wolverine
finds only Wolverine #99:

| Subset ID | Wolverine #99 card ID |
|---|---:|
| 6711 | 521712 |
| 6712 | 331092 |
| 6722 | 331192 |
| 6723 | 331292 |
| 6724 | 331392 |
| 6725 | 331492 |
| 6726 | 331592 |
| 6727 | 331692 |
| 6728 | 331792 |
| 6729 | 331892 |
| 6730 | 331992 |
| 6731 | 332092 |
| 6732 | 332192 |

There are **no existing IDs** for Rocket Racoon/Rocket Raccoon #136 or
Wolverine #148 under this parent. Other base examples: Black Widow #1 =
521613; Blue Bolt #100 = 521615.

The nine Comic Book Artist Autographs subsets (6713–6721) have zero cards.
They are distinct autograph subsets, not targets for cloning the base checklist.

## Limit and search inspection

- `server/routes.ts`, GET `/api/sets/:setId/cards`: default 36, maximum
  **100 per page**, with OFFSET, full active-row COUNT, and totalPages.
  This is not a total-checklist limit.
- `client/src/components/cards/card-grid.tsx`: selected sets use
  `fetchAllPages`, requesting 100 per page and continuing through totalPages
  (safety ceiling 50 pages). A 150-card subset would fetch two pages, not
  truncate at 100. The render path does not slice that array to 100.
- The same component ignores search/rarity/isInsert filters when setId is
  selected; it does not filter only a first 100-card page. That separate
  selected-set filtering defect overlaps the existing selected-set search task.
- `server/optimized-storage.ts`, `searchCardsOptimized`: name, set name,
  and number matching happen in SQL before the result limit (maximum 50).
  This search does not search only a previously loaded page.
- Stored subset totals are also genuinely 100. The set endpoint's total
  is independently counted from card rows, so changing metadata alone cannot
  provide the missing cards.
- `client/src/pages/browse-cards.tsx`, Add All: loops through totalPages.
  Individual collection adds in CardGrid use the selected card ID. These
  paths were inspected, not exercised; no collector data was changed.

## Proposed correction — approval required

Add only the 50 missing supplied number/name pairs #101–150 to each of the
13 listed base/parallel subsets: **650 new records total**. Preserve every
existing card ID, image, and collector reference; do not rename Wolverine #99
to #148. Reconcile each affected stored total to the actual 150 rows after
insertion, never just increase metadata.

Use the supplied spelling “Rocket Racoon” unless the owner approves
normalizing it to “Rocket Raccoon”. Do not copy base images onto parallels,
invent images, or populate autograph subsets from this list.

STOP: no correction has been applied. Approval after these findings is
required for any development catalog writes. Production stays read-only;
the delivery path for live corrections requires separate authorization.
No code-only pagination fix can create these missing catalog records.

## Verification and next steps

The evidence comes from production SELECT queries, including a JSON checklist
join comparing every expected number/name with each target subset. Application
tests and signed-in visual verification were not run because this deliverable
is a read-only findings report, not an implementation.

Existing selected-set search/filter work covers the independent UI defect.
No duplicate follow-up task is proposed. Catalog correction remains subject
to approval within the scope of these findings.

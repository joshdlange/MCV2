---
name: Scan-to-Add product constraints
description: Collector confirmation, photo review independence, and binder-page direction.
---

## Current authorization: cut-down dev v1

Build only in DEV; never publish; production is read-only. Preserve all existing `.local/` data and indexes. Checkpoint before each step. After reviewing the dev catalog refresh, the user authorized continuing steps 2–5 without stopping unless something breaks or needs their decision. The user authorized backing up dev, copying the production catalog with exact IDs, and clearing dev test references instead of remapping them.

**Why:** The user wants a phone-testable flow in 2–3 sessions, not weeks.

**How to apply:** Reuse C0 arm C and the existing search, confirm/add and photo-submission flows behind the default-off visual-retrieval flag. Skip auto-rotation and OCR in the scan path. Embed-on-save is now authorized in dev; production hosting remains checklist work, not production changes. Report end-to-end dev timing after the screen is wired. This authorization supersedes the older experiment-only restrictions below, especially their deletion instructions; do not delete retained `.local/` evidence.

## Mobile-browser acceptance

### Photo consent and approval rules

Scanner-matched Add never uploads a photo or creates a review item; discard the
photo on completion. A search-picked card with a usable image gets no photo offer.
For a search-picked card without a usable image, ask “Use your photo as this card's
image?”; only explicit Yes uploads, and No uploads nothing. “Report wrong image”
creates a reasoned review item with an optional, explicitly attached photo.
Only full admins bypass photo approval; trusted uploaders must queue until the
user decides otherwise.

**Why:** The user explicitly required these rules and a regression test preventing
matched Add from ever uploading or creating an admin item.

**How to apply:** Preserve consent across all single-card and future binder flows.
Do not retain scan bytes inside added-card notifications. Report real authenticated
end-to-end evidence separately from fixture, policy, or substituted-auth tests.

### Image replacement and paired proof

The user requires scan-reference corrections through the real admin image-replace or approved-photo flow, never a direct catalog DB edit. Saving the reference must automatically embed it and retire that card's old retrieval vector.

**Why:** A displayed-image fix alone leaves recognition using the bad reference. The user explicitly requested same-photo before/after ranks for Colossus #11 and diagnosis of Ghost Rider #28, both 2008 Masterpieces Set 2.

**How to apply:** Preserve the frozen baseline for valid paired comparisons; keep new references as durable per-card overrides. A reference-self-match or injected-vector test is not proof that the user's camera photo now works. Do not claim authenticated admin-path acceptance without actually exercising it.

### One-tap acceptance supersedes repeated confirmation

The user confirmed phone scans now work and requested top artwork/version preselected with inline version chips and one Add action, not card → version → confirmation. Close artwork scores should show alternatives with their own Add actions. Return to capture after adding, with safe Undo.

**Why:** The user called successful recognition good but found the multiple confirmations and failed-match fallback unusable.

**How to apply:** Keep results reusable as tiles for a future binder grid, without building binder scanning yet. “Not here?” uses Year → Set → Subset → Card with scan-derived starting context. Preserve missing-image photo offers after search-picked adds; do not reinstate mandatory confirmation or recognition cropping.

Phone testing must use a production-built frontend without Vite HMR, while the backend remains development-only on the dev database. Send the entire resized photo to recognition; crop only within optional card-image review. Keep phone actions visible without page scrolling.

**Why:** After the initial recovery fixes, the user reported one success out of three Android browser attempts and repeated page resets. An isolated established HMR socket termination reproduced Vite automatically reloading. This verifies the mechanism, not the historical phone trigger. The user explicitly removed recognition cropping because arm C was evaluated on uncropped photos.

**How to apply:** Do not switch the backend to production to obtain a production frontend, or restore recognition cropping as an optimization. Validate sequential scans against a no-HMR build and distinguish isolated mocked-auth testing from physical-device acceptance.

Do not describe isolated, mocked-auth browser checks as signed-in phone acceptance. The user tests the dev URL in an Android browser, not just the native app, and requires camera-file coverage including large iPhone photos and HEIC. Errors must keep an available photo and offer explicit retry/search.

**Why:** The user reported roughly nine resets out of ten phone attempts despite the earlier isolated tests passing. Only one attempt reached server telemetry; pre-upload failures could not be individually classified retrospectively.

**How to apply:** Distinguish real signed-in mobile evidence from desktop viewport/decoder tests. Inspect pre-upload lifecycle and authentication resets as well as inference; no scan event does not prove a specific file-format, network, or memory failure.

## Historical experiment constraints (not the current v1 scope)

### Approved start screen and binder direction

The user explicitly loved the start screen with useful information below the scan/search buttons. Preserve that direction rather than redesigning it during camera work. They want future wording to lean toward scanning a nine-sleeve binder page.

**Why:** The user confirmed the page with “I love this page now” and identified binder-page scanning as the intended direction.

**How to apply:** The user subsequently requested a Rapid Scan binder-page test button between Scan a card and Search instead. Keep that entry on the start page, with an explicit one-card-at-a-time test note until whole-page recognition exists.

Rapid Scan is authorized in DEV as sequential live-camera captures feeding a reusable batch review grid, not whole-page binder recognition.

**Why:** The user explicitly requested this intermediate step toward nine-pocket pages while keeping production and model changes out of scope.

**How to apply:** Keep no OCR, no retained/uploaded photos without explicit submission, explicit ambiguous-set choice, and Undo limited to newly created owned rows. Future pocket captures should feed the same review flow.

Phone scan identity selection must never preselect a set when artwork occurs in several sets. One tap on the correct set row adds it; parallel chips wrap below that row. Show five ranked artwork groups when available, full set names, and compact text-based browse steps starting at the guessed year's set list.

**Why:** The user scanned 1992 Darkhawk #11 and the UI favored a 2024 reprint; artwork similarity alone would silently add the wrong printing.

**How to apply:** Preserve one-tap Add, Undo, quick next scan, no recognition crop UI, no HMR, and existing photo consent rules. Verify at 390px, distinguish isolated UI screenshots from signed-in phone evidence, and stop after delivering requested screenshots—no publishing or production writes.

Use canonical single-image DINO alone for the next development recognition evaluation; do not run the historical reranker or reference-guided optional crop.

**Why:** The frozen reranker did not improve retrieval. Approved-reference-boundary dependence does not demonstrate independent card isolation. Historical production photos were deliberately deleted, so retained ranks cannot establish visual failure causes.

**How to apply:** Use `scripts/dev-dino-next-evaluation.mjs` as the next-experiment policy guard/default, not the historical frozen harnesses. Keep the DINO model and historical evidence/source hashes unchanged. No tuning, publication, production access, database writes, full indexing, or redownloading/reconstructing deleted photos is authorized. Analyze sanitized evidence only, mark unsupported visual causes unknown, and require explicitly supplied local evidence before another image evaluation. Investigate independent isolation separately; do not enable guided cropping or depend on approved catalog boundaries. These are experiment constraints, not changes to live application matching.

**Scoped supersession, not standing access:** The later explicit twelve-scan failure-audit authorization permits only its named scan IDs and three fields (scan ID, original image URL, confirmed card ID), read-only. It allows temporary visual review and a paired unchanged-DINO test of a detector operating on the photograph alone. No other production records/account data, reranker, guided crop, tuning, publication or writes. Freeze the independent detector before evaluation, report abstentions as raw fallbacks, and delete all newly owned temporary evidence after sanitized results are verified. Reusing that exception for another audit requires fresh authorization; the default remains no production access.

Evaluate stronger learned card isolation on mixed-difficulty real fronts, not by repeatedly tuning geometry on the same failed queries.

**Why:** Safe abstention alone does not establish useful isolation, and a failure-selected sample cannot measure regressions on previously successful photographs.

**How to apply:** Require a separately authorized, privacy-minimized bounded cohort. Freeze photo-only segmentation and geometric acceptance before viewing cohort outcomes; no identity, reference, OCR or DINO guidance. Manually judge physical-card coverage and corners before recognition. Evaluate every emitted crop, including bad ones, with unchanged canonical DINO; separately disclose QA-valid crops, abstention/raw fallback, missing-reference coverage and overlapping scene-stratum denominators. Preserve observed aspect and pad rather than stretching. Keep catalog duplicate investigation read-only and separate from label changes. Delete newly owned photographs/masks/crops/exports/vectors after validating sanitized metrics; no standing production access is granted by a completed experiment.

Collection ownership and shared-catalog photo approval must remain independent, including when a collector identifies the card manually.

**Why:** The user wants the confirmed card added even when an administrator rejects its photo because a better catalog image already exists. Image rejection is not rejection of ownership.

**How to apply:** Save the explicitly confirmed card independently of optional image submission. Keep collection limits/errors visible. Review outcomes must not gate or undo ownership, and UI copy must distinguish card-add success from photo-submission/review status.

Build reliable single-card recognition before expanding to nine-card binder pages, with collector confirmation before additions.

**Why:** The user considers current recognition unreliable and wants eventual binder-page scanning with each card confirmed.

**How to apply:** Preserve manual identification and explicit confirmation. Reuse improved single-card matching for individual page crops rather than treating a whole binder page as one card.

Treat visual artwork similarity as supporting evidence, never proof of an exact parallel.

**Why:** Many catalog entries share artwork, and some have no reference image. A visually convincing result can otherwise override metadata ambiguity and falsely identify a specific print.

**How to apply:** Preserve metadata confidence ceilings through visual reranking. Missing images are not negative identity evidence. Validate accuracy against reviewed real scans before claiming improvements in recognition rates.

Image-first recognition is the product goal, not OCR-first candidate lookup.

**Why:** The user clarified that collectors expect a Rare Candy-style photo identification experience; reranking a card-number shortlist does not meet that goal.

**How to apply:** Search catalog images independently of readable text. Use text as corroboration and to distinguish variants, not as a prerequisite for retrieving artwork. Report incomplete image-index coverage and distinguish transformed-reference tests from real-photo accuracy.

Validate stability, real-photo retrieval, and latency before further bulk ingestion or architecture expansion.

**Why:** The user brought an external review to stop speculative optimization and requested independently labeled evidence before scaling. Another rewrite or a large index does not establish recognition quality.

**How to apply:** Keep full indexing and publication paused. The user superseded the earlier 50-photo prerequisite: run bounded development experiments on current accepted labels without requesting more labeling first. Report sample size, selection bias, conflicts, leakage, and index coverage; a small exploratory experiment is not a general architectural accuracy claim.

Keep reference and query inference numerically equivalent; do not assume quantized model tensor batches equal single-image inference.

**Why:** The pinned DINO q8 model produced batch-composition-dependent embeddings in actual tests, despite identical per-image preprocessing. Strict parity caught the mismatch before full indexing.

**How to apply:** Pipeline downloads independently of inference; use the same single-image path for reference and query vectors unless an alternative passes strict parity or receives a new model version with validated retrieval behavior. Never reuse experimental incompatible vectors under the existing model version.

Do not treat engineering tests or collector selections as proof that recognition accuracy is fixed.

**Why:** The user explicitly requires representative real-photo evaluation, prioritizing false high-confidence errors, before accepting v1 as ready. Feedback can repeat a wrong suggestion and is not independently verified ground truth.

**How to apply:** Distinguish available scan volume from reviewed benchmark labels. Report unmeasured rates as unavailable, not zero; preserve a frozen labeled sample for before/after comparisons.

Keep scan identity review inside the existing admin interface, with server-persisted decisions consumed directly by benchmarking.

**Why:** The user rejected downloading an offline HTML pack and manually exporting/re-uploading JSON. Explicit admin confirmation is the labeling action; notes are optional, and uncertain scans must remain unresolved.

**How to apply:** Preserve the prepared original photos and historical suggestions. Keep this experimental review development-only until production use is explicitly approved; do not make file transfers a prerequisite for review or benchmarking.

Separate review-tool/catalog problems, front/back input type, and metadata defects from visual recognition accuracy. Bug-investigation examples are development cases, not an untouched holdout.

**Why:** Collector review exposed literal missing-value tokens, artist text mistaken for card numbers, back-only photos, blocked searches, and reported wrong reference images. Combining these into one accuracy rate would misrepresent retrieval performance.

**How to apply:** Preserve raw history and confirmed identities; store classifications and issue flags independently. Require explicit front/back evidence, report uncertain inputs separately, and reserve independently labeled untouched photos before final accuracy claims.

Reference-guided card isolation must distinguish the physical card boundary from the catalog photo's outer rectangle.

**Why:** Stronger generic edge detection accepted internal artwork and binder pockets as cards. Local-feature homographies were more useful, but projecting a slab, watermark, or scene-sized reference silently retains surroundings or clips content.

**How to apply:** Use only Stage 1 candidates, never the known label, to guide isolation. Require trustworthy reference-card extents and geometric safety gates; preserve raw/manual fallback. Report usable isolation separately from tight card-only crops and disclose offline reference preparation.

Use attributable, unambiguous historical collector confirmations as sourced labels instead of requiring redundant manual review; preserve manual decisions and surface conflicts.

**Why:** The user rejected repeated labeling and a permanent engineering-heavy admin workflow. Historical selected IDs can record explicit confirmation, whereas stored top predictions cannot. Confirmation before an ownership request does not prove that ownership was added.

**How to apply:** Keep label source/audit evidence explicit, prioritize manual labels, and never equate possible duplicate IDs automatically. Keep technical review diagnostics collapsed and identify frozen historical suggestions as historical—not fresh DINO results.
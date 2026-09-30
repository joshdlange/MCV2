---
name: Scan-to-Add product constraints
description: Collector confirmation, photo review independence, and binder-page direction.
---

Use canonical single-image DINO alone for the next development recognition evaluation; do not run the historical reranker or reference-guided optional crop.

**Why:** The frozen reranker did not improve retrieval. Approved-reference-boundary dependence does not demonstrate independent card isolation. Historical production photos were deliberately deleted, so retained ranks cannot establish visual failure causes.

**How to apply:** Use `scripts/dev-dino-next-evaluation.mjs` as the next-experiment policy guard/default, not the historical frozen harnesses. Keep the DINO model and historical evidence/source hashes unchanged. No tuning, publication, production access, database writes, full indexing, or redownloading/reconstructing deleted photos is authorized. Analyze sanitized evidence only, mark unsupported visual causes unknown, and require explicitly supplied local evidence before another image evaluation. Investigate independent isolation separately; do not enable guided cropping or depend on approved catalog boundaries. These are experiment constraints, not changes to live application matching.

**Scoped supersession, not standing access:** The later explicit twelve-scan failure-audit authorization permits only its named scan IDs and three fields (scan ID, original image URL, confirmed card ID), read-only. It allows temporary visual review and a paired unchanged-DINO test of a detector operating on the photograph alone. No other production records/account data, reranker, guided crop, tuning, publication or writes. Freeze the independent detector before evaluation, report abstentions as raw fallbacks, and delete all newly owned temporary evidence after sanitized results are verified. Reusing that exception for another audit requires fresh authorization; the default remains no production access.

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
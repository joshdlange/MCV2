---
name: Scan-to-Add product constraints
description: Collector confirmation, photo review independence, and binder-page direction.
---

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

Do not treat engineering tests or collector selections as proof that recognition accuracy is fixed.

**Why:** The user explicitly requires representative real-photo evaluation, prioritizing false high-confidence errors, before accepting v1 as ready. Feedback can repeat a wrong suggestion and is not independently verified ground truth.

**How to apply:** Distinguish available scan volume from reviewed benchmark labels. Report unmeasured rates as unavailable, not zero; preserve a frozen labeled sample for before/after comparisons.
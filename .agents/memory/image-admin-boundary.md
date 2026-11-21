---
name: Image Admin boundary
description: Security and accounting invariants for restricted card-image editors.
---

Card image URL replacements must go through the dedicated Image Admin workflow. The server normally downloads bytes itself using a validated, pinned public destination, re-hosts them to Cloudinary, then atomically updates the card and writes one audit event. Generic metadata-write routes must not accept image fields. The narrow exception is verified HTTPS `img.comc.com/i/` URLs: COMC blocks application-server downloads, so these use Cloudinary remote fetch after public-host validation.

**Why:** Passing arbitrary URLs directly to a remote fetcher allows redirect/DNS SSRF gaps, and alternative write paths can leave external URLs behind or bypass per-editor counters. COMC's Cloudflare policy makes the allowlisted exception necessary. Successful operations must remain recoverable, attributable, and all-or-nothing.

**How to apply:** Any new UI or API that replaces card images must reuse this workflow, preserve optimistic concurrency and old Cloudinary assets, and derive distinct-card/total-operation counters only from committed image-update audit events. Custom pinned DNS lookup callbacks must support Node's `options.all` array response form or production requests fail with an undefined IP.

Historical activity must be described as images **updated**, not newly added images. Count each recorded front/back side separately from edit operations and distinct cards.

**Why:** The existing historical audit records do not retain whether a side was previously missing, so new additions cannot be separated reliably from replacements. Do not infer historical additions from the card's current image.

**How to apply:** Keep this distinction in reports and comparisons; unknown side information is an explicit coverage gap, not an assumed single image.

Keep the entire Image Admin management and activity section under Image Automation, not Users.

2016 Masterpieces Silver Spectrum Autograph must use manually approved images, not automatic search results. The owner authorized clearing its existing images and keeping supplied Fin Fang Foom #3 and Werewolf By Night #4 replacements.

**Why:** The owner reported incorrect images and explicitly approved preventing automated searches from repopulating the cleared subset.

**How to apply:** Preserve this subset's manual-only policy in any future image-search or bulk-fill implementation; do not apply this clearing authorization to What If... or other parallels.

**Why:** The user explicitly requested that image-editor controls and reporting belong with image automation.

**How to apply:** Future image-editor reporting and role controls should stay together in that section.
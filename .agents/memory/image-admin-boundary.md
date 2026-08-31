---
name: Image Admin boundary
description: Security and accounting invariants for restricted card-image editors.
---

Card image URL replacements must go through the dedicated Image Admin workflow. The server normally downloads bytes itself using a validated, pinned public destination, re-hosts them to Cloudinary, then atomically updates the card and writes one audit event. Generic metadata-write routes must not accept image fields. The narrow exception is verified HTTPS `img.comc.com/i/` URLs: COMC blocks application-server downloads, so these use Cloudinary remote fetch after public-host validation.

**Why:** Passing arbitrary URLs directly to a remote fetcher allows redirect/DNS SSRF gaps, and alternative write paths can leave external URLs behind or bypass per-editor counters. COMC's Cloudflare policy makes the allowlisted exception necessary. Successful operations must remain recoverable, attributable, and all-or-nothing.

**How to apply:** Any new UI or API that replaces card images must reuse this workflow, preserve optimistic concurrency and old Cloudinary assets, and derive distinct-card/total-operation counters only from committed image-update audit events. Custom pinned DNS lookup callbacks must support Node's `options.all` array response form or production requests fail with an undefined IP.
---
name: Image Admin boundary
description: Security and accounting invariants for restricted card-image editors.
---

Card image URL replacements must go through the dedicated Image Admin workflow. The server downloads bytes itself using a validated, pinned public destination, re-hosts them to Cloudinary, then atomically updates the card and writes one audit event. Generic metadata-write routes must not accept image fields.

**Why:** Passing a URL directly to a remote fetcher allows redirect/DNS SSRF gaps, and alternative write paths can leave external URLs behind or bypass per-editor counters. Successful operations must be recoverable, attributable, and all-or-nothing.

**How to apply:** Any new UI or API that replaces card images must reuse this workflow, preserve optimistic concurrency and old Cloudinary assets, and derive distinct-card/total-operation counters only from committed image-update audit events.
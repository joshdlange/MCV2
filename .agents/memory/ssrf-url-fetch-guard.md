---
name: SSRF guard for URL-fetch endpoints
description: Any endpoint that fetches a user/admin-supplied URL server-side must validate hosts as public internet
---

Rule: any route that fetches a pasted/supplied URL server-side (metadata scrape, image fetch, etc.) must validate the destination before every hop: http/https only, DNS-resolve the host, and block loopback, RFC1918, link-local (169.254.x — cloud metadata), CGNAT, and .local/.internal names. Follow redirects manually, re-validate each hop, pin the validated public address, cap time/bytes, and enforce the expected content type.

**Why:** Architect review found multiple admin-only image/metadata fetches and browser-rendered avatar URLs that could reach local devices. Admin-only gating and browser Permissions-Policy headers are defense in depth, not sufficient mitigation.

**How to apply:** Reuse the current safe public-text or public-image downloader rather than raw fetch/remote URL ingestion. Never retain the original URL when safe ingestion fails. Browser-rendered avatars must use the controlled-origin avatar normalizer at both response and render boundaries; do not broaden its origin list for convenience.

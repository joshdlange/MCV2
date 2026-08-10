---
name: SSRF guard for URL-fetch endpoints
description: Any endpoint that fetches a user/admin-supplied URL server-side must validate hosts as public internet
---

Rule: any route that fetches a pasted/supplied URL server-side (metadata scrape, image fetch, etc.) must validate the destination before every hop: http/https only, DNS-resolve the host, and block loopback, RFC1918, link-local (169.254.x — cloud metadata), CGNAT, and .local/.internal names. Follow redirects manually and re-validate each hop.

**Why:** Architect review flagged an SSRF primitive in the Set Intelligence metadata fetch — an unguarded fetch lets anyone with route access probe internal services and cloud metadata. Admin-only gating is not a sufficient mitigation.

**How to apply:** Reuse `assertPublicHttpUrl` in `server/services/setIntelligence.ts` (or copy its pattern) for any new URL-fetching endpoint. Note the older openGraphScraper util does NOT have this guard — don't expose it to new user-supplied-URL routes without adding one.

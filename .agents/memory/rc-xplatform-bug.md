---
name: RevenueCat X-Platform server-side bug
description: RC v1 REST API rejects secret keys with error 7243 if X-Platform header is included in server-side calls
---

# RevenueCat X-Platform Header Bug

## The Rule
Never include `X-Platform: ios` (or any X-Platform value) in **server-side** RevenueCat REST API calls.

**Why:** RC v1 REST API uses the `X-Platform` header to determine whether the caller is a mobile client. If present, RC treats the request as a client-side call and rejects secret keys (`sk_...`) with error code 7243 — "Secret API keys should not be used in your app." This breaks server-side subscriber lookups silently (returns 200 with an error body, not a network error).

**How to apply:** In `server/routes.ts`, the `/api/revenuecat/activate` endpoint fetches `https://api.revenuecat.com/v1/subscribers/{id}`. Only include `Authorization` and `Content-Type` headers. The fixed endpoint (July 2026) has a comment explaining this. Do not re-add X-Platform in future edits.

## RC Audit Tool
`GET /api/admin/rc-audit?fix=true|false` — scans all users against RC, finds anyone with an active `super_hero` entitlement but wrong DB plan, and optionally upgrades them. UI card in Admin → Automation → "iOS Subscription Audit".

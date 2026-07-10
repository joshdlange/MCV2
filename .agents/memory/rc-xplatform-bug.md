---
name: RevenueCat X-Platform server-side bug
description: RC v1 REST API rejects secret keys with error 7243 if X-Platform header is included in server-side calls; also returns 200-with-error-body
---

# RevenueCat Server-Side REST API Pitfalls

## Rule 1: Never send X-Platform from the server
Do not include `X-Platform: ios` (or any X-Platform value) in **server-side** RevenueCat REST API calls. Only send `Authorization` + `Content-Type`.

**Why:** RC v1 REST API uses `X-Platform` to decide the caller is a mobile client, then rejects secret keys (`sk_...`) with error code 7243 — "Secret API keys should not be used in your app." This silently broke all iOS activations (server returned failure, client didn't check it).

**How to apply:** Any fetch to `api.revenuecat.com/v1/subscribers/...` from `server/` must omit X-Platform.

## Rule 2: RC returns HTTP 200 with an error body
A failed RC lookup can come back as **HTTP 200** carrying `{ code, message }` (the 7243 case), not a network error. Checking only `res.ok` treats these as success and silently skips the user.

**Why:** An audit/lookup that only inspects `res.ok` will report false "all clear" while every lookup actually failed.

**How to apply:** After `res.json()`, treat `!res.ok || !body || typeof body.code === 'number'` as a failed check and count/surface those errors separately from "no entitlement found."

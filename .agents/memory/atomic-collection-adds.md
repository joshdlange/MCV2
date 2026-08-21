---
name: Atomic collection adds
description: Transaction rule for distinct-card limits, idempotent retries, and concurrent collection additions.
---

# Atomic collection adds

Enforce a user's distinct-card limit in the same per-user database transaction as the ownership lookup and insert/update. An idempotent request for an already-owned card must return the existing row even when the user is at the limit.

**Why:** A count-first route check rejected harmless retries at the limit, while separate count and insert operations allow concurrent requests for different cards to exceed the limit.

**How to apply:** Every plan-limited collection-add path must serialize by user, distinguish an existing card from a new distinct card before applying the limit, and test repeat-at-limit plus concurrent-add behavior.
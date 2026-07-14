---
name: eBay API quota accounting
description: Pitfalls when budgeting eBay API calls in the pricing service
---

- The pricing service's hourly limiter (`waitForRateLimit`/`canMakeRequest`) only wraps the Finding API path. The Browse API paths (primary + fallback) do raw `fetch` and bypass it — any call counter/budget must increment at those fetch sites too, or batch jobs report 0 calls used.
- One "price a card" operation can fire many API calls (up to ~9 query variations + fallback). Budget by API calls, not by cards.
- **Why:** first version of the nightly backfill capped cards, not calls, and could blow the ~5,000/day eBay quota; live test showed the counter missing all Browse calls.
- **How to apply:** any new bulk pricing job should use `getTotalRequestCount()` deltas for its budget, take the `nightly-pricing-backfill`-style pg advisory lock for multi-instance safety, and never raise the shared hourly limit without a hard per-run budget.

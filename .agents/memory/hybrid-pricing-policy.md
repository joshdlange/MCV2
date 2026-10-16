---
name: Hybrid Check Value policy
description: Approved selective SoldGraph activation, eBay fallback, and verification boundaries.
---
SUPER_HERO Check Value should try cached SoldGraph first, then a safeguarded selective refresh, then retain the usable eBay baseline if sold data is absent or unavailable. Ordinary reads must not call providers. Side Kick retains its quiet 20-lifetime allowance; SUPER_HERO has no entitlement cap, but global safeguards still apply.

**Why:** The user explicitly approved activation after their production checks were still returning active-listing estimates instead of attempting sold comparisons.

**How to apply:** Keep source labels accurate, never erase baseline prices, never use SoldGraph for a catalog-wide refresh, and distinguish development/provider-service evidence from signed-in production verification. Publishing remains a separate user action.

Manufacturer aliases must remain product-family-specific; never make Upper Deck and SkyBox globally interchangeable.

**Why:** The user explicitly requested surgical normalization and strict rejection of graded/parallel Wolverine comps. Upper Deck's official 2020 Marvel Masterpieces checklist verifies the What If Level 2 numbering, but does not justify relaxed matching for other products.

**How to apply:** Require authoritative checklist evidence before extending alias scope or inferred serial numbering; test wrong variants and unrelated product families.

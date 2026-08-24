---
name: Stripe coupon product scopes
description: Stripe coupon product restrictions can be hidden from ordinary SDK responses.
---

Stripe's `Coupon.applies_to` product scope is an expandable field. A coupon can
be correctly restricted in Stripe while an ordinary create or retrieve response
omits the field.

**Why:** Treating an omitted default response as an absent restriction risks
weakening a product-specific discount, while treating it as proof of scope
would silently accept an unrestricted offer.

**How to apply:** When validating a product-limited coupon, retrieve it with
`expand: ["applies_to"]` and verify the expected product ID is present before
enabling or emailing its promotion codes.
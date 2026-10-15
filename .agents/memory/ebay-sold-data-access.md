---
name: eBay sold-data access
description: Verified access limitation and constraints for genuine completed-sale pricing.
---
Do not claim a query/matching fix supplies genuine sold prices without verifying an authorized completed-sales source.

**Why:** During the 2026-10-14 investigation, the existing eBay connection successfully obtained its ordinary token, but the underscored Marketplace Insights endpoint returned 403 Access denied. Requesting the dedicated buy.marketplace.insights scope returned 400 invalid_scope and issued no token. The hyphenated endpoint returned 404, which alone did not diagnose entitlement.

**How to apply:** Recheck entitlement if the owner's eBay permissions change. eBay's published support page said Insights was restricted and not open to new users; the Finding API was retired in February 2025. Do not fall back to scraping or describe active asking-price estimates as verified sales. PriceCharting's published terms require permission for public redistribution; an API key alone is not permission.

The user states MCV is an active eBay Partner Network publisher.

**Why:** This is relevant business context for an access request, not proof of sold-history entitlement.

**How to apply:** Include this context in requests to eBay without claiming it grants Insights access.

Evaluate upstream authorization separately from a provider's commercial display license.

**Why:** The Card API's terms reviewed on 2026-10-15 allow paid commercial applications but explicitly disclaim compliance with originating marketplaces' terms. A paid API and a display license do not establish authorized eBay sourcing.

**How to apply:** Before recommending adoption, require written source-rights confirmation and representative Marvel numbered-parallel sale samples; do not treat marketing claims about accepted Best Offers as verified transaction evidence.

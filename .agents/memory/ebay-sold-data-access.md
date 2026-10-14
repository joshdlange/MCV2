---
name: eBay sold-data access
description: Verified access limitation and constraints for genuine completed-sale pricing.
---
Do not claim a query/matching fix supplies genuine sold prices without verifying an authorized completed-sales source.

**Why:** During the 2026-10-14 investigation, the existing eBay connection successfully obtained its ordinary token, but the underscored Marketplace Insights endpoint returned 403 Access denied. Requesting the dedicated buy.marketplace.insights scope returned 400 invalid_scope and issued no token. The hyphenated endpoint returned 404, which alone did not diagnose entitlement.

**How to apply:** Recheck entitlement if the owner's eBay permissions change. eBay's published support page said Insights was restricted and not open to new users; the Finding API was decommissioned on 2025-02-04. Do not fall back to scraping or describe active asking-price estimates as verified sales. PriceCharting's published terms require permission for public redistribution; an API key alone is not permission.

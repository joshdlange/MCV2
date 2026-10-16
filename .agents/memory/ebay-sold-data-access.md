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

The user reports eBay Developer Support confirmed no Marketplace Insights access or alternative historical sold API is available to MCV, and authorized a development-only SoldGraph pilot.

**Why:** Production replacement and pricing UI changes must wait for explicit approval of test results. SoldGraph Best Offer flags identify displayed asking prices, not accepted amounts.

**How to apply:** Keep the old provider/caches intact, exclude Best Offers from the sold median, do not apply 0.85, and do not publish or switch production merely because the pilot succeeds. Resolve development card identity by metadata instead of assuming production IDs refer to the same card.

The user approved preparing the production-ready integration, but not activation or publishing. Confidence must be categorical: 3+ usable comps normal, 1–2 limited data. During gradual migration, unrefreshed and zero-comp cards retain positive legacy estimates with explicit legacy source tracking; without fallback, show unavailable rather than zero dollars.

**Why:** Sparse sold-listing samples should not imply reliable market values or worthless cards.

**How to apply:** Preserve these distinctions in pricing displays. Keep live provider activation separate from code readiness, and confirm the provider account allowance rather than assuming the intended paid plan is active.

The user authorized a manual operator-only quota-aware bulk refresh tool, not an automatic schedule or a live bulk run.

**Why:** Migration must prioritize collector demand and respect the rolling provider allowance without blindly refreshing the entire catalog.

**How to apply:** Keep dry-run estimates, a configurable safety reserve, bounded priority batches and resumable progress. Do not enable the pricing switch or schedule merely because the operator tooling is ready.

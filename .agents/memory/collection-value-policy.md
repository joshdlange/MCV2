---
name: Collection value policy
description: Agreed valuation source, privacy limits, and test-data boundaries.
---
Collection value uses positive cached market prices only, never catalog estimates or personal values. Include owned quantities in the total; rank cards by per-copy value, not the total value of duplicates. Treat nonpositive or missing prices as unpriced. Page views must not trigger bulk external price lookups.

**Why:** The user explicitly chose cached market prices only when approving the Most Valuable Cards brief. All collection-value displays must agree.

Owners always see their own top cards. Visitors may see values only when the profile is public and the collection is shared, subject to block checks. Friends-only visibility does not grant access to top-card values.

**Why:** The feature brief explicitly restricts visitor values to public collections.

**How to apply:** Keep dashboard, collector profile, and value-page totals on the same calculation. Use development-only synthetic price/collection fixtures for testing; cleared development prices are expected, not a production pricing bug.

Leave usable development demo data available for hands-on review before publishing; label synthetic prices clearly in the handoff and preserve existing cached rows.

**Why:** Automated fixtures were cleaned up, leaving the user's newly added dev cards unpriced and the feature impossible to review interactively.

Top Cards should feel like a showcase of the collector's “holy grail”: emphasize the highest-valued card with a larger image and a trophy, then a grid. No sort or $5 controls on the showcase; show 25 initially and load further batches only on request.

**Why:** The user replaced the original filterable-list direction with a showcase and explicitly wants to avoid unnecessary system load.

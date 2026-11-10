---
name: CompsAPI evaluation boundaries
description: Owner's isolated provider-comparison scope and pitfalls of historical listing aggregates.
---
CompsAPI work is an isolated same-cohort evaluation, not permission to replace SoldGraph or alter production pricing.

**Why:** The owner explicitly requested an objective comparison with no publishing, provider switch, catalog edits, or unrelated application changes.

**How to apply:** Keep paid experiments bounded and preserve the frozen SoldGraph comparison. Request explicit authorization before integrating a replacement provider.

CompsAPI's reported price can be a listing's average paid per unit across multiple sales, including accepted offers. Its title-derived flags can mistake the character Random for mystery merchandise and miss graded titles or variants.

**Why:** These behaviors were observed/documented during the controlled comparison; higher returned counts alone did not establish accurate raw-card pricing.

**How to apply:** Retain raw rows, unit counts, offer flags and dates; independently review grades/lots/parallels. Distinguish listing observations from individual transactions and historical coverage from recent-price coverage.

Filtering a long-window response by last_sold is not equivalent to requesting a shorter price window.

**Why:** A multi-unit listing can have a recent last sale but an average price covering earlier sales in the requested period. A date filter alone does not establish a recent transaction price.

**How to apply:** Label offline recency slices as listing-activity estimates. For claims about current price accuracy, verify window-specific price semantics or individual-sale records; do not infer improvement from a new weighting formula without a truth benchmark.

---
name: Native review milestones
description: Product and reliability rules for badge-triggered native store review moments.
---

Native review moments must keep the reward independent from the review request. Award the badge from its own behavior-based milestone, use no review CTA or incentivized-review language, and never infer whether a rating or review was completed.

**Why:** Store review APIs may suppress their UI and do not report completion. Tying a reward to the request or outcome violates store policy, while treating every auth retry as a new launch can accidentally manufacture the milestone.

**How to apply:** Reuse one process-stable launch ID across all auth retries, deduplicate it server-side, wait for higher-priority intro dialogs to complete for the current session, and use a replay-safe one-winner claim before invoking the native API.
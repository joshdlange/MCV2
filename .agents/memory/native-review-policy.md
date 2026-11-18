---
name: Native review policy
description: Native store prompts are the default; trading work follows the mobile update preparation.
---

Use the native Apple/Google review popup as the default automatic review experience.

**Why:** The user explicitly requested returning to the native review popup for the next updates to both mobile stores.

**How to apply:** Keep review requests independent of badge rewards, allow store suppression, and avoid repeat prompting. The latest release requirement supersedes earlier manual-store-link behavior: native sheet only, no web review modal or fallback redirect. Trading is subsequent collaborative work, not authorization to build it during mobile release preparation.

Keeping Score is a fourth authenticated device-session milestone, not a reward for clicking Leave a Review or submitting a review.

**Why:** The owner explicitly confirmed the fourth-session award after discussing review-incentive concerns; supplied artwork is approved for Keeping Score.

**How to apply:** Award independently of plugin availability and OS display. Preserve existing badges and XP calculations; use the normal bronze 10-XP convention for this new badge.

Replit prepares web code only for this release; the owner uses a separate local Mac packaging step for native builds. No publishing without explicit approval.

**Why:** The current store binaries lack the plugin and must remain safe when loading newer web code.

**How to apply:** Never modify ios/ or android/ during this preparation; guard every native review invocation with both native-platform and plugin-availability checks, silently skipping missing plugins.
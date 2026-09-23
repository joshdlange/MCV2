---
name: Native vault creative direction
description: User feedback on launch animation and reusable preview.
---

Use continuous footage for the vault opening rather than crossfading separately rendered stills. Keep a replayable development preview with phone-size comparisons when changing launch footage.

**Why:** On 2026-09-23 the user rejected the six-image treatment as visibly separate images, supplied a continuous video instead, explicitly liked the preview, and wants to replace the clip periodically.

**How to apply:** Preserve native-only detection and fail-open safety when rotating footage. Do not assume a new clip authorizes web startup playback.

Play the complete clip even when authentication or app startup is already ready, followed by full black and a quick app reveal.

**Why:** The user explicitly overrode the original early-ready shortcut after publishing: it interrupted the experience and made it look incomplete.

**How to apply:** Do not couple splash lifetime to auth/loading state or route subtrees. Verify the handoff over the real production-built app, including already-ready startup and routing during playback; a standalone preview does not exercise those interruptions. Account for media-loading time when preserving the hard deadline so normal completion does not race the final fade.
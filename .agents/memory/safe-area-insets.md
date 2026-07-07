---
name: Mobile safe-area insets (notch/cutout)
description: Why env(safe-area-inset-*) fails on Android WebView and the universal pattern this app uses
---

**Rule:** Never use `env(safe-area-inset-*)` directly for mobile layout offsets. Use the `--safe-area-top/left/right` variables defined in `client/src/index.css`, which are `max(env(...), var(--safe-area-inset-*, 0px))`.

**Why:** Android WebViews report `env(safe-area-inset-top)` as 0 even when drawing edge-to-edge under the status bar/camera cutout (caused header overlap on Pixel 8 Pro). Capacitor 8's built-in SystemBars plugin instead injects `--safe-area-inset-*` as inline CSS custom properties on `<html>` (Android 15+, requires `viewport-fit=cover` in the meta viewport, which index.html has). iOS WebKit is the opposite: `env()` works, no injection. `max()` of both covers every platform and computes to 0 on desktop/plain web (no visual change).

**How to apply:** Any new fixed/sticky mobile UI (headers, sticky toolbars, page top padding) must offset with `var(--safe-area-top)`, e.g. `top-[calc(4rem_+_var(--safe-area-top))]`. The mobile header grows its height by the inset so the 64px content row is never squeezed.

**Bonus:** Because `capacitor.config.ts` points the app WebView at the production URL, safe-area CSS fixes reach installed apps on web publish — no AAB/iOS rebuild needed.

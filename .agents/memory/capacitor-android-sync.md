---
name: Capacitor Android plugin sync
description: Why native Capacitor plugins can silently be missing from the Android AAB and how to sync them in this repl
---

# Capacitor Android plugin sync

**Rule:** Any change to Capacitor plugin dependencies (or any Android release) requires regenerating the Android project; otherwise `android/app/src/main/assets/capacitor.plugins.json` stays stale and native plugins silently ship missing from the AAB.

**Why:** The Android project's generated files (`capacitor.settings.gradle`, `app/capacitor.build.gradle`, `capacitor.plugins.json`) are only written by `cap update/sync` — installing an npm Capacitor plugin does nothing to the binary by itself. This repo shipped an AAB with `capacitor.plugins.json = []`, so `@capacitor/app` was absent and the hardware back button exited the app instantly (JS `backButton` listeners can never fire without the native plugin). App-state/deep-link listeners were silently dead too.

**How to apply:** Before every Android build, run `cap update android`. Gotchas in this environment:
- Capacitor CLI 8 requires Node ≥22 but the project runs Node 20 — run it one-off via `nix-shell -p nodejs_22 --run "node_modules/.bin/cap update android"` (do NOT change the project runtime).
- Keep `@capacitor/cli` on the same major as `@capacitor/core` (both 8.x now).
- `capacitor.config.ts` uses remote `server.url` (app.marvelcardvault.com), so JS changes ship via web publish, but native plugin changes ALWAYS need a new AAB/IPA.
- Symptom check: if a Capacitor JS API silently does nothing on device, first check `capacitor.plugins.json` lists the plugin class.

# Changing the native entry clip

1. Replace `media/vault-entry.mp4` with a silent portrait H.264 MP4
   (`yuv420p`, faststart, preferably 720×1280, at most 3.6 seconds).
2. Replace `media/vault-poster.webp` with its first frame. This also serves
   reduced-motion users, who never request the video.
3. Update `durationMs` in `clip.ts` if the clip is shorter. Keep the final
   200ms footage-to-black fade, 120ms fully black hold, and 300ms app reveal.
   Handoff timings are shared between JS and CSS through `vaultHandoff` in
   `clip.ts`. Reduced motion retains its shorter 40ms hold / 180ms reveal.
   The independent four-second launch deadline must not be extended.
4. Review `/__dev/vault` in development at each phone preset, then run
   `scripts/test-vault-launch.mjs` with an external Playwright installation.
   Test installed iOS/Android apps before release.

No admin setting, API, or database change is needed. Vite hashes the imported
assets, so replacing them produces fresh URLs while repeat launches can cache
the same clip. Ordinary web startup never imports the visual chunk.

This runs once at the native application's stable React root, outside auth and
route providers, not after every sign-in, route change, or resume. The whole
clip plays even if authentication is already ready or becomes ready mid-clip.
The final 200ms fades to black using actual media time. Media `ended` plus the
completed footage fade starts the 120ms black hold; only the completed 300ms
overlay animation normally removes the overlay. Auth readiness is never an
exit signal. Errors and the four-second deadline still dismiss immediately.
The studio previews the same sequence over the live app in a same-origin frame.
Normal loading overhead is absorbed by a modest playback-rate adjustment
(1–1.25× maximum), preserving all footage and reserving 550ms for the completed
black handoff plus scheduling margin. An excessively slow start fails open
instead of cutting a normal reveal short or extending the four-second bound.

Source for the current clip:
`attached_assets/video_1790202730621_1f360421_1790202841148.mp4`.
Its complete four seconds were gently accelerated to 3.6 seconds (no action
cut out), scaled from 1440×2560 to 720×1280, and encoded H.264 CRF 23 at 30fps
with faststart. No extra shaking, artwork overlays, or color filters were added.
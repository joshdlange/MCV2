# Changing the native entry clip

1. Replace `media/vault-entry.mp4` with a silent portrait H.264 MP4
   (`yuv420p`, faststart, preferably 720×1280, at most 3.6 seconds).
2. Replace `media/vault-poster.webp` with its first frame. This also serves
   reduced-motion users, who never request the video.
3. Update `durationMs` in `clip.ts` if the clip is shorter. Keep the 300ms fade
   and independent four-second launch deadline; do not extend startup.
4. Review `/__dev/vault` in development at each phone preset, then run
   `scripts/test-vault-launch.mjs` with an external Playwright installation.
   Test installed iOS/Android apps before release.

No admin setting, API, or database change is needed. Vite hashes the imported
assets, so replacing them produces fresh URLs while repeat launches can cache
the same clip. Ordinary web startup never imports the visual chunk.

This runs during initial native session restoration, not after every sign-in,
route change, or resume. It exits immediately when the app is ready. The studio
intentionally previews the full clip against a neutral backdrop.

Source for the current clip:
`attached_assets/video_1790202730621_1f360421_1790202841148.mp4`.
Its complete four seconds were gently accelerated to 3.6 seconds (no action
cut out), scaled from 1440×2560 to 720×1280, and encoded H.264 CRF 23 at 30fps
with faststart. No extra shaking, artwork overlays, or color filters were added.
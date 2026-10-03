# Dev phone scan investigation — 2026-10-03

## Second retest and no-HMR follow-up

User reported one success in three Android-browser attempts after refreshing, with
two further silent resets and actions below the viewport. The earlier changes did
not resolve the phone problem.

Confirmed mechanism: the installed Vite client's abnormal established-WebSocket
close handler waits for a successful ping and calls location.reload(). The isolated
scripts/test-vite-disconnect.mjs test terminated the actual socket and observed two
main-frame navigations and navigation type reload. A simple browser offline/online
toggle did NOT reproduce it. Neither experiment proves the phone's historical trigger.

The dev workflow now builds a production-mode frontend and serves static assets
while retaining NODE_ENV=development, existing dev DB and strict visual-v1 gate.
No Vite client or HMR socket is needed. Normal production deployment scripts are
unchanged. Auth refresh preservation also applies to this explicit phone build.

Recognition now immediately resizes the complete selected frame; the source photo,
decoded bitmap, preparation canvases, mutation file references and superseded object
URLs are released. Optional review cropping uses a separate photo state. Recognition
never uses that crop. The phone workspace has internally scrolling lists and a
persistent Add / Not here? action bar.

Diagnostics contain random page identity, sequence/attempt, navigation type,
elapsed timing, previous phase, current stage and categorical failure reason.
Page load, hide/show, visibility changes and uncaught errors are included; no
photo, filename, account identity, URL or raw error text is logged.

Production-built component harness evidence:
.local/scan-v1/qa/production-phone-1791046972075/evidence.json.
Five consecutive real recognition calls passed with mocked auth/collection writes;
25 layout checks passed at 393x852 and 360x640. Alternating landscape/portrait 12MP
images arrived as 1600x1200 / 1200x1600, not fixed-aspect crops. After reset, tracked
object URLs and canvas pixels were zero. Retry/search and separate review crop passed.
This is explicitly not a signed-in physical-device test. The live dev app's public
config reports visualV1=true and its HTML serves hashed production assets.

The earlier investigation below is historical, not a claim that its first fixes
resolved the Android resets.

## Evidence

Queried development scan telemetry at 16:40 UTC for the preceding hour. It contained
one event: successful scan starting 16:37:05 UTC, selected card 19255, browser total
3542.8 ms, backend measured processing 2829.4 ms. No search or photo-review submission.
The HTTP log records POST /api/cards/scan 200 at 16:37:06, then collection POST 201.

The retained dev log has repeated auth sync followed by scan config/usage loads:

| Central time | Observable result |
| --- | --- |
| 11:35:03 | Screen initialization; no corresponding completed scan request |
| 11:35:21 | Same |
| 11:35:41 | Same |
| 11:36:05 | Same |
| 11:36:17 | Same |
| 11:36:33 | Same; the eventual successful upload follows at 11:37:06 |
| 11:37:31 | Screen initialization again; no subsequent completed scan request |
| 11:37:48 | Same |

These are screen loads, NOT a proven one-to-one list of camera attempts. The user's
roughly nine failed attempts cannot individually be classified from the old evidence.
No recorded scan rejection, 401, size/type failure, timeout, 500, or empty result
explains them. The successful scan reached inference and confirmation; the others
left no inference event. The available preview browser console is not the phone's
console, and its historical network trace is unavailable.

Repeated screen initialization supports a client lifecycle/reset problem, but does
not establish whether Android discarded the tab, auth notifications unmounted it,
or another client event caused each reset. Do not claim a proven historical cause.

## Changes

- Enabled dev scans retain already-verified same-UID auth sessions during refresh;
  initial login, identity changes, sign-out and permanent backend errors stay gated.
- Persistent error state retains available source/cropped File and preview; explicit
  retry and search replace the old error-to-idle transition.
- HTTP, non-JSON proxy responses, malformed success, token, network and 60-second
  deadline errors have recoverable messages.
- Local HEIC conversion, bounded 1600px image surfaces, blob previews and a clear
  40MB input ceiling reduce decoding pressure; legacy production path unchanged.
- A scalar camera-interruption marker explains page reloads instead of silently
  starting over. If the browser discarded the page before returning the photo,
  the user must reselect it; no claim of recovering unavailable bytes.
- Authenticated dev-only categorical diagnostics now cover camera/selection/decode/
  crop/request failures. No photos, filenames, free text, or URLs in these logs.

## Verification

- Focused recovery/auth/route/collection tests passed (48 in the combined initial
  run, with an additional diagnostic endpoint test subsequently passed).
- Real development URL, phone-size desktop Chromium: a public HEIC sample converted
  locally; a synthetic 4032x3024 JPEG of 35,593,831 bytes became a 1600x1200 JPEG of
  970,325 bytes. These are NOT original iPhone-camera acceptance tests.
- Real inference browser fixture passed, including forced HTML 502 response,
  retained photo preview and retry without reselection. Authentication and write
  APIs in that fixture remain mocked.
- Public mobile-size screenshot shows intact normal sign-in.
- A real signed-in physical-phone/camera session remains unverified. No access to
  the user's existing phone browser session was available.

No publishing or production writes. Existing .local evidence preserved.
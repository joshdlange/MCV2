# Native review + Keeping Score release handoff

## Status and boundaries

Web-side preparation only. Nothing published. No changes to `ios/` or `android/`.
Existing store versions supplied by the owner: iOS 1.0.2 (16), Android 1.0.4 (11).
They do not contain the review plugin and silently skip requests.
Do not publish until the owner explicitly approves. Do not treat partial browser
QA below as approval to release.

## Prior work and reuse

Git history contains `8c335039` (merged by `6f559d07`), “Implement native review
workflow and update mobile build configuration.” Its isolated nativeReview module,
dashboard hook, tests, and existing dependency were still present and connected.
Those were reused rather than creating a second prompt framework.
The old server-count eligibility, permanent request claim, warning log, and
fourth-login web dialog/store-link mission were replaced. Existing Vault Regular,
native launch ledger, authentication decisions, and XP calculations are unchanged.

## Exact plugin contract

- Package: `@capacitor-community/in-app-review`, pinned to **8.0.0** in both manifests.
- Confirmed against npm metadata: peer `@capacitor/core >=8.0.0`.
- Named import: `InAppReview`.
- Availability string: `Capacitor.isPluginAvailable("InAppReview")`.
- Both `Capacitor.isNativePlatform()` and availability are checked before calls.
- `InAppReview.requestReview()` is caught silently; no warning, modal, link, or fallback.
- No submitted-review detection. Request resolution does not prove display or submission.

## Qualifying session and suppression

`client/src/contexts/AuthContext.tsx` records only after Firebase identity has
successfully synchronized with the backend and the pending operation is still current.
No count from failed sync, API retry, route change, render, or token refresh.

Device/browser-profile localStorage key: `mcv:native-review:device:v2`.
Contains firstAppOpenAt, authenticatedSessionCount, lastSessionId,
lastReviewPromptRequestedAt, reviewMilestoneAwarded and awarded account IDs.
It is device-local, not imported from server nativeMobileLogins, and no new DB
session-counter column is added.

Native: reuse the existing in-memory native-launch ID. One cold WebView/JS
application opening counts; foreground/background does not create another ID.
A complete WebView reload creates a new opening.
Browser: one sessionStorage ID at `mcv:review:authenticated-opening` per tab session;
reloads and repeated auth in that same tab do not count again.
Normal repeated callbacks reuse the ID, so local counting is idempotent.
This is local engagement state, not a cryptographic record of logins.

Session **4 or later** is eligible if no native request has previously been
attempted. Missing-plugin binaries preserve the opportunity and do not set a
request date or start a cooldown; the next eligible session after upgrading can
request it. Keeping Score is awarded independently.
After dashboard data is ready and onboarding is complete, wait 15 seconds.
Skip if backgrounded or any dialog/alertdialog/aria-modal is open.
Unmounting the dashboard cancels the timer. A skipped opportunity is not forced.

Claim lastReviewPromptRequestedAt immediately before invoking the OS. Suppress
for at least **120 × 24 hours**, including a rejected native promise or OS-suppressed
sheet. An existing request timestamp also consumes this one-time milestone even
after 120 days: no recurring campaign is scheduled. Legacy account/device request
markers are conservatively retained because they have no trustworthy timestamp.
Unavailable/denied/corrupt storage skips safely rather than repeatedly prompting.
Clearing app data clears local state; OS quotas still apply.

## Keeping Score badge

Owner confirmed: award for the fourth authenticated device session, **not a
Leave a Review click**. The award can catch up on a later dashboard visit if a
network error prevented delivery. It works without the native plugin and never
depends on the review outcome.

- Name: **Keeping Score**.
- Description: “Returned for four authenticated app sessions on one device.”
- Bronze, **10 XP**: existing default bronze convention; no new XP calculator.
- Artwork: supplied owner image, hosted as
  `https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795041190/badges/keeping-score.webp`.
- Registration: `server/services/returningCollectorMilestone.ts`, startup seeded.
- Existing badges/user_badges, uniqueness constraint, award service and normal
  achievement notification are reused. No placeholder is visible.
- Authenticated endpoint: `POST /api/badges/returning-collector-milestone`.
  Body `{ "sessionCount": 4 }`; authenticated identity determines the recipient.
  Counts below 4 are rejected. Awarding is unique per account across devices.
- Device claims are client-reported (a deliberate consequence of the local-only
  requirement), so this is not tamper-proof attestation. Replays cannot farm XP:
  the existing `(user_id, badge_id)` uniqueness permits one award only.
- No further artwork or name is needed.

## DEV reset

On a Vite development build, open the dashboard and run
`window.mcvResetReviewMilestone()` in the console. It clears this feature's local
session count, first-open time, request date, local badge state and browser session
ID, then reloads. It does **not** revoke an earned server badge or remove legacy
review claims. To test the full new-user path, use a dedicated test account/profile.
The helper is compiled out of production, including `dev:phone`'s built frontend.
No production UI is added.

## International audit

Target store availability: United States, Canada, Australia, New Zealand only.
The current profile country field is free text, not a supported-country selector.
Country, state and postal fields have no US-only validation in that form.
The existing US placeholder/default behavior is preserved. No selector or extra
countries were introduced, and there were no country-list changes to make.

US marketplace shipping defaults and legacy allowed-countries restrictions exist
in marketplace/billing paths; they were deliberately **not changed**, per the
explicit scope restriction. Pricing providers also use US marketplace/USD
assumptions; app availability does not imply local-currency market values.
No Stripe, RevenueCat, IAP, subscription prices, currency conversions, address
redesign, catalog, collection, scan, navigation or affiliate changes.

Outside Replit: select exactly US/CA/AU/NZ in App Store Connect and Play Console,
review regional store listings/privacy/support disclosures, and validate existing
store-managed subscription availability without changing prices here.

## Local Mac packaging — not run in Replit

1. Pull the approved web changes and use Node 22+; run `npm ci`.
2. Confirm `npm ls @capacitor-community/in-app-review @capacitor/core` shows 8.0.0
   for the review plugin and compatible Capacitor 8 packages.
3. Run **`npx cap sync ios`** and **`npx cap sync android`** on the local packaging
   checkout. Both are required to add/register the native plugin.
   Preserve the existing remote production URL. Do not substitute a dev URL.
4. Verify plugin registration in both native builds before archiving.
5. iOS plugin podspec/SPM declares minimum **iOS 15**, Swift 5.1 podspec, Swift
   tools 5.9 SPM, and Capacitor 8 dependency. Use the project's Capacitor-8-compatible
   Xcode toolchain; do not lower any existing minimum.
6. Android plugin declares default **minSdk 24**, compile/target **36**, Java **21**,
   Android Gradle Plugin **8.13.0**, Play Review **2.0.2**. Root-project overrides
   exist; reconcile them with the Capacitor 8 project. Do not blindly replace
   Gradle/toolchain files with these defaults.
7. No review-specific permission or API key is needed. Maintain existing app
   identity, signing, remote URL, billing and privacy configuration.
8. Increment versions/build numbers from the latest accepted store records, not
   merely the historical versions listed above.
9. iOS: test StoreKit review behavior on a development device. TestFlight does not
   display the review sheet; production display is controlled by Apple.
   Android: test through Play internal testing with an eligible tester/account;
   sideloads alone do not establish real Play review behavior.
10. Verify native session 1–3 silent, session 4 eligible only after dashboard
    stability, badge independent, old-plugin-missing binaries silent, modal and
    background deferral, repeated navigation/retries silent, request timestamp
    recorded even when OS shows nothing. No badge for review submission.

## Verification evidence and remaining release gates

- Earlier pass: 27 review/session, ordinary-mission, backend sync and existing
  Vault Regular tests passed.
- Final focused pass: 12 Keeping Score registration/award, review/session and
  ordinary-mission tests passed. Dedicated DB fixture was removed.
- Desktop Chromium and mobile Chromium emulation: login screen loads; no page
  errors, native-plugin errors, review dialog or store redirect after 17 seconds.
  Evidence: `generated-artifacts/native-review-qa/results.json`.
- Signed-in browser login/navigation and fourth-session rendered badge are
  **not verified**: no dedicated browser test credentials were available.
- Actual mobile Safari and Chrome devices are **not verified**. The available
  runner has Chromium only; Playwright WebKit executable is unavailable.
- Automated testing helper was unavailable; fallback local Chromium checks were
  used. Do not report mobile emulation as real-device Safari/Chrome QA.
- Native sheets require the later real native builds; they cannot be verified in
  the web preview.

Browser QA is therefore incomplete. Do not publish or treat this as a release
sign-off. GitHub delivery is held until the requested browser-QA gate is met;
local preparation commits are not production deployments.

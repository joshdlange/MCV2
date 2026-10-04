# Native review release checks

The default automatic review request is the operating system's review sheet.
It runs on the dashboard after 15 uninterrupted seconds, once the authenticated
account has at least four native launch sessions. Existing eligible accounts
are included. It does not run on the web, during a modal, in the background, or
in older binaries without the plugin.

The request is marked once per account/device in local storage before calling
the OS. Suppression or failure does not cause a retry loop. Clearing app data
can clear that marker; store quotas still apply. No code claims that a review
was submitted or gives a reward for requesting/submitting a review.
Vault Regular remains independently awarded for native launches.

The optional dashboard “Leave a Review” button opens the relevant store on
native platforms. On the web it offers both store links. Explicit buttons
must not depend on native review APIs: those may intentionally display nothing.

## Before release

- Publish the web changes separately. Current binaries safely skip the new
  automatic prompt until the native plugin ships.
- Android: run `npx cap update android` with Node 22+, then the normal signed
  release build. Check `capacitor.plugins.json` includes `InAppReviewPlugin`.
- iOS: pull the package and lockfile changes on the Mac, run `npm ci`, then
  `sh scripts/ios-sync.sh`. The iOS project is not in this workspace.
- Increment each store's build number using its latest accepted build as the
  source of truth. Do not infer that number from the web package version.
- Test Android via a Play internal-testing installation, not only a sideload.
  Test iOS on a device from Xcode; TestFlight does not show the review request
  UI. Production display is controlled by Apple/Google quotas and is not
  guaranteed.
- Verify launch four eligibility, later-launch catch-up, no repeated request
  after dashboard navigation, and no interruption of an open modal.
- Verify Android three-button and gesture navigation: Scan “Not here?” and
  Rapid Scan actions remain above the system controls. Verify an iPhone home
  indicator as well.
- Confirm manual store links, scan preparation text, close-match guidance,
  normal Add, and optional photo submission.

No signed builds or store submissions are produced by changing web code alone.
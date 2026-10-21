# Market Price browser regression check

Run `npm run test:market-browser` with the development database available.
Chromium defaults to `/repl/tools/bin/chromium`; override with `CHROMIUM_PATH`.
No additional packages or live pricing credentials are needed.

## What runs

- Desktop (1280 × 900) and mobile browser layout (393 × 900), one isolated
  Side Kick account per layout, starting with 19 consumed refreshes.
- Real `CardValue`, `CardDetailModal` Check Value action, API request/event handling, `MarketUpgradeHost` and
  `UpgradeModal`, `NotificationBell`, `XpPowerMeter`, and Social badge page.
- Real `SoldgraphCache`, `awardValueScout`, badge insertion/deduplication,
  notification creation/read services, and `computeUserXp`.
- The 20th refresh succeeds; the next uncached refresh opens the upgrade
  modal; fresh-cache refreshes remain available at the cap without provider calls.
- Gating shows no error or false success toast, with and without a legacy
  estimate. In-flight refreshes show a neutral notice and preserve cached
  values. Missing-data and HTTP-failure controls still show destructive toasts.
- The detail window's Check Value action also covers gating and in-flight
  responses both without a price and with a retained legacy estimate.
- Repeated/concurrent successful refreshes leave exactly one badge, one
  persisted notification and 10 XP. Browser checks cover notification delivery,
  read receipt, navigation to the earned badge, XP breakdown, and reload persistence.
- Unauthenticated refreshes return 401. Unexpected API requests and browser
  exceptions fail the run.

## Isolation and limits

This is an authenticated **component/service integration harness**, not a live
Firebase sign-in or a test of the entire production Express route stack.
Random per-account test sessions are accepted only by its temporary loopback
server. Firebase identity imports are replaced only in its esbuild bundle.
Production auth, routes and provider configuration are not changed.

The temporary API connects production services to the production UI; successful,
gated and in-flight pricing responses, badge awards, notifications and XP use
real services. The external sold-comps provider (including account quota) and
unrelated social feed emission are mocked. Missing-data and HTTP-failure controls
are injected at the browser boundary to verify error toasts.
Payment providers and external browser network requests are never contacted.
This verifies mobile responsive layout, not native iOS/Android purchase flows.

Each run creates a random PostgreSQL schema with empty structural copies of
required tables. Copied serial defaults are replaced with schema-local identity
sequences; no customer rows are copied or updated. All connections use only
that schema in `search_path`. Cleanup closes browser/server/pools and drops the
schema in `finally`, including assertion failures. A force-killed process may
leave a `market_browser_*` schema that needs manual cleanup.

Screenshots are written under `generated-artifacts/market-price-browser/`
(ignored by Git and publishing). Notification and XP delivery are checked
after reload, matching existing query-cache behavior; this test does not claim
the mounted bell or XP meter updates immediately after refresh.

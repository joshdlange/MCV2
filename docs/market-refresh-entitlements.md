# Market Price entitlement and Value Scout

Activation/publishing remain OFF. No paid SoldGraph searches or bulk jobs were
run for this implementation.

## Account entitlement

`market_refresh_usage` stores an internal lifetime count keyed by user ID, separate
from XP, with account-deletion cascading. No count is returned to clients.
Only explicit authenticated refresh routes pass a user ID to SoldGraph refresh;
operator work omits it. The server rechecks current plan/admin status in the
reservation transaction, rather than trusting a client or cached entitlement.

Fresh cache and per-card lock deduplication happen before entitlement accounting.
Global-budget checks also happen first. A row-locked update allowing consumed<20
reserves an entitlement in the same transaction as the provider search reservation.
It is retained when the search starts. Simultaneous different-card requests cannot
cross the cap. SUPER_HERO and admins skip the entitlement check/reservation.
Downgrading resumes the Side Kick counter; paid/admin requests do not consume it.

The client does not expose the counter or provider vocabulary. A required search
at the cap returns upgradeRequired with best cached pricing, and the existing
UpgradeModal opens with:
“Unlock unlimited Market Price refreshes with SUPER_HERO.”

## Provider failures

The provider client currently discards response credit metadata. Definite rejected
searches (missing/invalid key, invalid query, HTTP 400/422, quota/rate rejection)
and explicitly failed jobs refund the entitlement. Successful empty results count,
because they consume a search credit. Ambiguous timeout/network/poll failures retain
the reservation: the remote job might have been accepted and billed. A crash between
reservation and submission can conservatively retain a reservation too. No automated
retry spends another credit. Global quota accounting remains conservative separately.

## Global and abuse protections

24-hour cache, per-card PostgreSQL advisory lock, shared request budget/reserve,
15-minute cooldown and provider timeout remain. A shared database throttle permits
30 explicit refresh attempts/user/minute and 120/IP/minute across instances. IPs
are hashed for the throttle key; expired throttle rows are removed after a day.
These abuse protections are not subscription entitlement caps.

## Badge

Value Scout is seeded idempotently and uses the supplied image at
`/value-scout.webp`. Description: “Checked the market and uncovered a card's value.”
Bronze, 10 XP, following DEFAULT_BADGE_XP. XP is derived from the existing
user_badges row—not a new XP event or counter. Award uses BadgeService, its
unique user/badge insert, existing notification and feed emission.

An explicit refresh returning a positive legitimate sold/limited/cached/baseline
price is eligible. Empty, upgrade-gated and in-flight responses are not. Ordinary
GET and batch price reads never invoke the badge helper. No retroactive awards.

## Hybrid display retained

SoldGraph becomes refresh-eligible at 24 hours, but positive results stay preferred
for SOLDGRAPH_DISPLAY_MAX_AGE_DAYS (default 14). Then a positive legacy baseline
is preferred; otherwise unavailable. Failed refreshes do not erase either cache.

## QA

Run the SoldGraph matcher, migration integration and Value Scout tests with
NODE_ENV=development. Integration tests use a temporary PostgreSQL schema and
fake providers, exercising usage 0/19/20, same/different-card races, paid/admin
exemption, cache hits, explicit rejection refund, ambiguous timeout and global
reserve. Badge helper tests mock the established idempotent award contract;
signed-in modal and notification delivery require separate visual verification.

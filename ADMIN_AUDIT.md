# Marvelous Card Vault — Admin Tools Audit & Cleanup Plan
**Date:** July 16, 2026 · **Type:** Audit only — no code, data, or behavior was changed.

---

## 1. Admin Tool Inventory

### A. Admin Pages (frontend)

| Tool | Files | Route | Purpose | Protection | Prod-data risk | Status | Recommendation |
|---|---|---|---|---|---|---|---|
| Admin Dashboard | `client/src/pages/admin/dashboard.tsx` | `/admin` | Central hub with live stats + links to all tools | Admin toggle (isAdmin) | Read-only | Active, current | **KEEP** |
| Manage Users | `client/src/pages/admin/users.tsx` | `/admin/users` | Edit users, plans, admin flag, delete; Level column | Admin-only API | High (user/plan changes) | Active, current | **KEEP** |
| Manage Main Sets | `client/src/pages/admin/main-sets.tsx` | `/admin/main-sets` | Create/edit master sets, assign sets | Admin-only API | Medium | Active | **KEEP** |
| Unassigned Sets | `client/src/pages/admin/unassigned-sets.tsx` | `/admin/unassigned-sets` | Assign orphaned sets to master sets | Admin-only API | Medium | Active | **KEEP** |
| Add Cards | `client/src/pages/admin/card-management.tsx` | `/admin/cards` | Single + bulk CSV card creation | Admin-only API | High (card imports) | Active | **KEEP** (add confirmation before bulk import) |
| Data & Image Automation | `client/src/pages/admin/automation.tsx` | `/admin/automation` | Background jobs + campaign controls | Admin-only API | High (triggers jobs, emails) | Partially stale — hardcoded June 2026 campaign cards | **UPDATE** — remove expired campaign cards; duplicate RC-audit panel |
| Upcoming Sets Tracker | `client/src/pages/admin/upcoming-sets.tsx` | `/admin/upcoming-sets` | Release calendar, RSS sync triggers | Admin-only API | Low | Active, current | **KEEP** |
| Image Approvals | `client/src/pages/admin/image-approvals.tsx` | `/admin/image-approvals` | Approve/reject user card photos | Admin-only API | Medium (swaps card images) | Active, current | **KEEP** (reject is instant — add confirm) |
| Migration Console | `client/src/pages/admin/migration-console.tsx` | `/admin/migration-console` | Move cards between sets, archive sets | Admin-only API + type-to-confirm phrases | High | Active; best-in-class guardrails | **KEEP** (model for other tools) |
| Base Set Population | `client/src/pages/admin/base-set-population.tsx` | `/admin/base-set-population` | Clone variant card data into empty base sets | Admin-only API | High | Active | **KEEP** |
| Conversion Funnel | `client/src/pages/admin/analytics.tsx` | `/admin/analytics` | Funnel stats, churn, upgrade-modal analytics | Admin-only API | Read-only | Active; duplicates RC-audit UI from Automation | **UPDATE** — de-duplicate RC-audit panel (keep in one place) |
| Legacy Admin Panel | `client/src/pages/admin.tsx` | none (shadowed by dashboard) | Old image-finder test page | n/a | n/a | **DEAD** — imported but never routed | **DELETE/ARCHIVE** |
| Card Editor | `client/src/pages/admin/card-editor.tsx` | none (orphaned) | Simple create-card form | n/a | n/a | **DEAD** — no route, superseded by Add Cards | **DELETE/ARCHIVE** |

### B. Admin API Endpoints (backend, `server/routes.ts`)

All admin endpoints use `authenticateUser` + inline `isAdmin` check **except the 3 flagged in Section 2**. Verified by automated sweep of every `/api/admin/*` route.

| Endpoint(s) | Purpose | Data mod | Email | Status / Recommendation |
|---|---|---|---|---|
| GET `/api/admin/users`, PATCH/DELETE `/api/admin/users/:id`, POST `/api/admin/upgrade-user` | User management, manual plan grants | Yes | No | KEEP |
| GET `/api/admin/stats`, `/api/admin/funnel-stats`, `/api/admin/rc-audit` | Dashboards | No | No | KEEP |
| POST `/api/admin/bulk-card-import`, `/api/admin/bulk-image-import`, CSV upload | Bulk imports | Yes (heavy) | No | KEEP — has batching; add dry-run summary |
| POST `/api/admin/update-missing-images`, `/api/admin/pricecharting-import/start` | Bulk image/pricing jobs | Yes | No | KEEP — verify still used; pricecharting may be stale |
| POST `/api/admin/pending-images/:id/approve` / reject | Image approval flow | Yes | Yes (user notification) | KEEP (preserve as-is) |
| `/api/admin/migration/*` (preview/execute/logs), `/api/admin/archive-legacy/*` | Migration console | Yes | No | KEEP — has preview/dry-run + audit logs |
| POST `/api/admin/badges`, `/api/admin/badges/retroactive-check` | Badge admin | Yes | No | KEEP |
| POST `/api/admin/sync-contacts` | Firebase → Brevo contact-list sync | External only | No | KEEP — Brevo is intentionally contacts-only (sending moved to Resend) |
| POST `/api/test-email`, `/api/admin/test-resend-email` | Test sends | No | Yes | KEEP — both verified admin-protected (test-email fixed July 2026) |
| POST `/api/admin/campaigns/*/send` | Bulk campaign blasts | No | Yes (mass) | UPDATE — add recipient-count confirmation + dry-run |
| GET `/api/admin/cache/clear` | Clear in-memory caches | No | No | KEEP (harmless) |
| POST `/api/admin/run-image-migration`, GET `/api/admin/image-migration-status` | COMC→Cloudinary migration (new, July 2026) | Yes | No | KEEP |
| POST `/api/admin/find-card-image/:cardId` | eBay image search + DB update | **Yes** | No | **DANGEROUS — unprotected, see §2** |
| POST `/api/admin/test-ebay-integration` | eBay test call | No | No | **Unprotected, see §2** |
| POST `/api/admin/create-user` | Creates admin user | **Yes** | No | **DANGEROUS — unprotected, see §2** |

### C. Cron Jobs & Background Jobs

| Job | File | Schedule | Prod data | Email | Status |
|---|---|---|---|---|---|
| Nightly Pricing Backfill | `server/ebay-pricing.ts` | 3 AM CT | Yes | No | KEEP — active, current |
| COMC→Cloudinary Image Migration | `server/services/imageMigration.ts` | 1:30 AM CT | Yes | No | KEEP — new |
| RevenueCat Reconciliation | `server/services/revenueCatSync.ts` | 7 AM CT | Yes | Admin status email | KEEP |
| Upcoming Sets RSS Sync / Auto-Expire | `server/services/upcomingSetsSync.ts` | Mon 5 AM / daily 6 AM CT | Yes | No (in-app msgs) | KEEP |
| Monthly Nudges + Digest | `server/jobs/emailCron.ts` | 1st of month, 9 AM | Timestamps | Yes (users) | KEEP — gated by `EMAIL_CRON_ENABLED` (currently unset → off) |
| Vault Upgrade Drip | `server/jobs/emailCron.ts` | Daily 9 AM | No | Yes (90/day) | UPDATE — verify campaign finished; retire if done |
| One-time dated campaigns (Google Play Jan 10, THANKS2U Jun 10/24, Vault Upgrade Jul 10) | `server/jobs/emailCron.ts` | Fixed past dates | No | Yes | **DELETE/ARCHIVE** — all dates have passed; dead code that still registers cron entries every boot |
| background-scheduler (Daily Image Updates 2 AM ET, Weekly Maintenance, Daily Market Trends) | `server/background-scheduler.ts` | Various | Yes | No | **UPDATE/REVIEW** — overlaps with newer imageMigration; likely partially stale |

### D. Standalone Scripts (`scripts/`, manual-run only)

| Script | Purpose | Danger | Recommendation |
|---|---|---|---|
| `comc-image-population.ts`, `comc-massive-image-population.ts` | High-volume COMC scraping/uploads | **High** — quota exhaustion, IP blocks; superseded by nightly migration | **ARCHIVE** — move out of scripts/ or add a guard prompt |
| `comc-job-manager.ts` | Stateful bulk image job manager | Medium | ARCHIVE with the above |
| `migrate-images-to-cloudinary.ts` | Older manual migration CLI | Low | ARCHIVE — superseded by nightly cron |
| `update-missing-images.ts`, `daily-market-update.ts` | CLI wrappers for existing jobs | Low | KEEP |
| `compare-sets-dryrun.ts` | Read-only comparison | None | KEEP |
| `firebase-export/` (whole directory) | Old full app snapshot incl. a clone of routes.ts with weaker auth | None at runtime (not served) | **DELETE/ARCHIVE** — confusing, stale, and a copy-paste hazard |

---

## 2. Security / Protection Issues ⚠️

Verified directly in code — these are the **only** three unprotected admin endpoints (automated sweep of all `/api/admin/*` routes confirmed everything else has `authenticateUser` + `isAdmin`):

1. **POST `/api/admin/create-user`** (routes.ts ~173) — **No auth at all.** Creates a user with `isAdmin: true`, SUPER_HERO plan. Worse: it generates a new `firebaseUid` (`admin-` + timestamp) every call, so the "already exists" check never matches — anyone on the internet can create unlimited admin rows in the production database. (Login still requires Firebase, so takeover risk is indirect, but this is a real hole and DB pollution vector.) **Fix immediately: delete the endpoint.**
2. **POST `/api/admin/find-card-image/:cardId`** (routes.ts ~2989) — **No auth.** Lets anyone trigger eBay API calls (quota cost) and overwrite a card's image URL in production. **Fix: add admin guard or delete.**
3. **POST `/api/admin/test-ebay-integration`** (routes.ts ~3024) — **No auth.** Triggers server-side eBay test calls. Lower risk (no data writes) but burns API quota. **Fix: add admin guard or delete.**

Also noted: there is **no shared `requireAdmin` middleware** — every endpoint repeats an inline check. That's how the three above slipped through. A single reusable middleware would prevent recurrence.

Good news: `POST /api/test-email` is confirmed fixed (admin-only), and no other privileged endpoint is exposed.

## 3. Dangerous Tools (can modify/import/email/sync)

- **Mass email:** `/api/admin/campaigns/*/send` — no recipient-count preview or dry-run before blasting.
- **Bulk data:** bulk-card-import, bulk-image-import, base-set-population, migration/execute, badges/retroactive-check — all admin-protected; only Migration Console has strong type-to-confirm guardrails.
- **External sync:** `/api/admin/sync-contacts` (Brevo contact lists) — one click, no preview of how many contacts will be pushed.
- **Scripts:** the two COMC population scripts can hammer external APIs if run by accident.
- **Unprotected trio** in §2 — the only ones outsiders can reach.

## 4. Stale or Duplicate Tools

- `client/src/pages/admin.tsx` — dead legacy panel, shadowed by the dashboard.
- `client/src/pages/admin/card-editor.tsx` — orphaned, duplicates Add Cards.
- RC-audit panel duplicated in **both** Automation and Analytics pages.
- `automation.tsx` — hardcoded June 2026 campaign cards (expired).
- One-time dated email campaign jobs in `emailCron.ts` — all dates passed.
- `server/background-scheduler.ts` — overlaps the newer COMC migration; needs a use-it-or-lose-it decision.
- `firebase-export/` — full stale app snapshot including an old routes.ts clone.
- Old COMC scripts superseded by the nightly migration cron.
- No stale Brevo-sending or 250-card Side Kick references found in active admin tools (Brevo usage is contacts-only by design).

## 5. Recommended Admin Navigation (going forward)

Keep the dashboard-hub model, grouped:
- **Overview:** Dashboard · Conversion Funnel (analytics, incl. the single RC-audit panel)
- **Catalog:** Add Cards · Main Sets · Unassigned Sets · Base Set Population · Migration Console
- **Images:** Image Approvals · Image Migration status (new panel for the nightly COMC job)
- **Users:** Manage Users
- **Releases:** Upcoming Sets Tracker
- **Automation & Email:** Jobs status (pricing backfill, image migration, RSS sync, RC reconciliation) · Contact Sync · Test Email
- Remove from nav: expired campaign cards, anything pointing at dead endpoints.

## 6. Cleanup Roadmap

**Priority 1 — security & dead weight (do first, small and safe):**
1. Delete `POST /api/admin/create-user`; admin-guard (or delete) `find-card-image` and `test-ebay-integration`. ← the only production-behavior change proposed, and it's a security fix.
2. Add a shared `requireAdmin` middleware and adopt it on all admin routes over time.
3. Delete dead frontend files: `pages/admin.tsx`, `pages/admin/card-editor.tsx`.
4. Remove expired one-time campaign jobs from `emailCron.ts` and their cards in `automation.tsx`.

**Priority 2 — usability & guardrails:**
5. De-duplicate the RC-audit panel (keep in Analytics only).
6. Add recipient-count preview + confirm to campaign sends and contact sync.
7. Add a confirm step to image rejection and bulk card import.
8. Decide fate of `background-scheduler.ts` jobs (keep or retire) and archive superseded COMC scripts + `firebase-export/`.
9. Add an admin panel for the new image-migration status/trigger.

**Priority 3 — new features:**
10. Build the Google Drive / Cloudinary image sync tool on the cleaned-up foundation (reuse Migration Console's preview + type-to-confirm pattern).

## 7. Final Recommendation

**Start with the three unprotected endpoints — today.** `create-user` in particular is reachable by anyone and writes admin rows to your production database. It's a 15-minute fix (delete one, guard two) plus a publish. Then remove the two dead frontend pages and expired campaign jobs — zero user-facing risk.

**Do not touch yet:** the image approval flow, Migration Console, password reset/Resend email paths, PC Binders, card limits, any user-facing routes, or Android/iOS native files. Hold the Google Drive sync until Priority 1 is done.

## QA Confirmation
- ✅ No production data was modified — audit used code reading only.
- ✅ No emails were sent.
- ✅ No imports or scripts were run.
- ✅ Audit/report only — zero code changes in this task.

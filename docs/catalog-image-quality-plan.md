# Phase D plan: catalog image quality and eBay attribution

- **Status:** PLAN ONLY (2026-10-01). Nothing built, nothing published.
- **Scope:** separate track from Phase C0; touches no C0 harness or pre-registration file.
- **Delivery:** each item ships in its own commit behind admin-only UI or a feature flag.

## D1. Admin crop queue for existing catalog images

**Flow**
1. `/admin/image-crop-queue` (admin-only, production) lists cards with an eligible front image.
   - Priority: collection count (`user_collections` rows per card), then wishlist count, then card ID.
   - **There is no card-view tracking in the schema.** Ranking by views would need a new counter first;
     I suggest collection count until then.
   - Placeholder images, archived cards and cards already cropped are excluded.
2. The admin marks 4 corners with the existing tool (`shared/cardCorners.ts`): printed top-left first,
   the rest in any order, auto-ordered, convex check.
   - A client-side preview shows the rectified 5:7 result before saving.
   - "Skip" and "Image is fine" both take the card out of the queue.
3. **Save** has the server warp the original to 5:7. Portrait output is 750×1050 (landscape 1050×750),
   bilinear, never stretched beyond the marked quadrilateral. It is uploaded as a **new** Cloudinary
   asset (folder `catalog_cropped`, via `uploadImage`, whose fit 800×1120 is already 5:7).
   - **The original Cloudinary asset is never modified or deleted.**
4. The card switches to the new URL. The old URL and the corners are kept in a version row, so
   **Revert** restores the original URL in one click.
5. No automatic cropping.

**Schema (new table, additive)**
```ts
export const cardImageVersions = pgTable("card_image_versions", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  side: text("side").default("front").notNull(),
  previousUrl: text("previous_url").notNull(),   // what the card showed before this change
  newUrl: text("new_url").notNull(),             // the new Cloudinary asset
  kind: text("kind").notNull(),                  // 'perspective_crop' (later: 'report_fix', 'scan_photo')
  corners: jsonb("corners").$type<[number, number][]>(),
  status: text("status").default("active").notNull(), // active | reverted
  createdBy: integer("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revertedBy: integer("reverted_by").references(() => users.id),
  revertedAt: timestamp("reverted_at"),
}, t => ({ cardIdx: index("card_image_versions_card_idx").on(t.cardId, t.createdAt) }));
```

**Today's behaviour to fix along the way:** approving a collector photo overwrites
`cards.front_image_url` with no record of the previous URL (`server/routes.ts:9110`, and the
admin approval path). D1's version table should also record those overwrites.

**Visual index:** reference vectors are keyed by URL (`visualReferenceKey(url)`,
`server/services/catalogVisual.ts`).
- After a crop, the old vector drops out of search immediately: eligibility is joined on the
  card's current URL.
- The new URL is unindexed until embedded:
  - Today: by the background worker, when `CATALOG_VISUAL_INDEX_ENABLED` is on.
  - Phase C: by an explicit single-image enqueue on change.
- Revert is instant if the original's vector still exists, because vectors for old URLs are not deleted.
- The cropped image needs a new vector. It is not interchangeable with the original's.

**Effort:** about 3–4 days. Queue query plus page about 1 day; corner UI reuse and preview about
0.5 day; server warp, upload, version row and revert about 1–1.5 days; tests about 0.5–1 day.

## D2. "Report image" on the card detail page

**UI**
- A tiny "Report image" link under the image in `client/src/components/cards/card-detail-modal.tsx`.
- It opens a dialog with these reasons: wrong card, card back, not cropped, blurry/low quality, other
  (+ an optional note up to 300 characters).
- After sending, it shows "Thanks, an admin will review it."

**Rules**
- One open report per user per card, enforced by a partial unique index.
- Rate limit of 10 reports per user per hour and 30 per day. These are DB count checks, because the
  app has no request rate-limit library.

**Admin queue**
- `/admin/image-reports` lists open reports grouped by card, with counts per reason and the image as reported.
- Actions:
  - **Fix**: opens the D1 corner tool, or the existing image replacement. Marks the reports fixed and
    links the resulting `card_image_versions` row.
  - **Dismiss**: takes an optional note.

**Schema change**

The existing `reports` table is for marketplace reports (users, listings, orders), so this is a new table:
```ts
export const cardImageReports = pgTable("card_image_reports", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  reporterId: integer("reporter_id").references(() => users.id).notNull(),
  reason: text("reason").notNull(),              // wrong_card | card_back | not_cropped | low_quality | other
  note: text("note"),
  reportedImageUrl: text("reported_image_url"),  // snapshot: the image the user saw
  status: text("status").default("open").notNull(), // open | fixed | dismissed
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
  imageVersionId: integer("image_version_id").references(() => cardImageVersions.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({
  statusIdx: index("card_image_reports_status_idx").on(t.status, t.createdAt),
  reporterIdx: index("card_image_reports_reporter_idx").on(t.reporterId, t.createdAt),
  oneOpen: uniqueIndex("card_image_reports_one_open_idx").on(t.cardId, t.reporterId).where(sql`status = 'open'`),
}));
```
Equivalent SQL, as an additive migration:
```sql
CREATE TABLE IF NOT EXISTS card_image_reports (
  id serial PRIMARY KEY,
  card_id integer NOT NULL REFERENCES cards(id),
  reporter_id integer NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('wrong_card','card_back','not_cropped','low_quality','other')),
  note text CHECK (char_length(note) <= 300),
  reported_image_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','dismissed')),
  resolved_by integer REFERENCES users(id),
  resolved_at timestamp,
  resolution_note text,
  image_version_id integer REFERENCES card_image_versions(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_image_reports_status_idx ON card_image_reports (status, created_at);
CREATE INDEX IF NOT EXISTS card_image_reports_reporter_idx ON card_image_reports (reporter_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS card_image_reports_one_open_idx ON card_image_reports (card_id, reporter_id) WHERE status = 'open';
```

**Migration path:** this needs a decision. The project's established convention is idempotent
startup DDL in `server/index.ts` (most tables, e.g. `follows`), because `db:push` is blocked by legacy
duplicates. Phase A moved only the visual-index table out of startup DDL. Options:
1. Follow the convention: startup DDL plus `shared/schema.ts`.
2. Keep a reviewed SQL file that you apply by hand before publishing.

Either way, it runs against production only when you choose.

**Effort:** about 2–3 days. Schema and routes with rate limits about 1 day; detail-page link and dialog
about 0.5 day; admin queue about 1 day; tests about 0.5 day.

## D3. eBay price attribution

### Where eBay-derived prices render

There is **no price-source field** anywhere. eBay is the only automated source, but
`cards.estimated_value` mixes eBay, admin-entered and seeded values, and collection totals also
mix in collectors' own `personal_value`.

| Render site (`client/src/…`) | Field | eBay-derived |
|---|---|---|
| `components/cards/card-detail-modal.tsx:834, 885` ("Market Price"), `:859` (toast) | `avgPrice` | yes |
| `components/cards/card-pricing.tsx:63-64` (used in `card-grid.tsx:475`: browse, search) | `avgPrice` | yes |
| `components/cards/card-value.tsx:104` (used in `pages/my-collection.tsx:872, 984`) | `avgPrice`, falls back to `estimatedValue` ("est") | mixed |
| `components/dashboard/trending-cards.tsx:108, 115` (already tags "eBay"/"DB") | `avgPrice` / `estimatedValue` | mixed |
| `components/dashboard/stats-dashboard.tsx:259-270` | `totalValue` | mixed (includes `personal_value`) |
| `pages/market-trends.tsx:126, 170, 398, 412, 418, 448, 461` | `market_trends` data | yes |
| `pages/CollectorProfile.tsx:625` (public), `:798` | `totalValue`, `estimatedValue` | mixed |
| `pages/FriendProfile.tsx:421, 470, 617, 645` | `totalValue`, `estimatedValue` | mixed |
| `pages/Social.tsx:1654, 1913` | `totalValue`, `estimatedValue` | mixed |

**No attribution** on user-entered values:
- marketplace listing and sale prices
- order totals
- wishlist max price
- sale-price input
- set MSRP
- admin payouts

Share pages, binders and emails render no prices.

**Proposed line:** "Prices via eBay" in `text-[10px] text-gray-400`, already used at
`pages/collector-binder.tsx:168`. Inside the dark detail modal, use the existing `text-xs text-gray-400`
line at `card-detail-modal.tsx:891` ("Updated: …").
- On mixed sites, show it only when an eBay value is actually displayed (`card-value.tsx` `isMarketPrice`
  and `trending-cards.tsx` `hasBackendPricing` already know).
- On totals, say "Market prices via eBay; includes your own values" when `personal_value` contributes.
- One small `<PriceSource />` component placed at about 12 sites.
- **Effort:** about 0.5–1 day.

### What eBay's API License Agreement says

Source: the eBay API License Agreement, `https://www.edp.ebay.com/join/api-license-agreement`
(page footer dated Sept 3, 2025). I read it through a summarizing fetch tool, which could not quote
long passages verbatim, and the section numbering differed between two reads. **Read the clauses below
directly before acting.** This is not legal advice.

1. **Attribution wording:** I found **no mandatory attribution text or "Powered by eBay" requirement**
   in the agreement itself. Logo use is governed by eBay's separate API Logo Usage Requirements.
   Plain text "Prices via eBay" with no logo avoids those, but check that document if a logo is ever added.
2. **More important: the pricing feature itself may conflict with the licence as built.**
   - **Average selling prices** (section 8.1(d), "Prohibited Use and Derivation", per the fetch):
     deriving average selling price statistics requires **eBay's express prior written permission**.
     `card_price_cache.avg_price` is exactly such a value.
   - **Price modeling** (section 9(e)): using eBay content "to suggest or model prices for items listed
     on eBay" is a restricted activity. Card "market value" estimates may fall under it.
   - **Freshness** (section 8.1(c)): listing data may be at most 6 hours older than eBay's site, and
     other eBay content at most 24 hours. Prices here are cached with `last_fetched`, and the nightly
     backfill prices about 1,000 cards per night (`server/index.ts`, `ebay-pricing.ts`), so most stored
     prices are older than 24 hours.
   - **No co-mingling** (section 8.1(b)): eBay content in a public display must be visually separate from
     non-eBay content. Collection totals that blend eBay prices with collectors' own values, shown on
     public collector profiles, may conflict with this.
   - **Marketplace Insights** (`server/ebay-marketplace-insights.ts`) is a Limited Release API that eBay
     approves per developer. If this app has that access, the approval may come with its own terms or
     the written permission above. Check that correspondence first.

**Recommendation:** add the attribution line (cheap, harmless), but treat licence compliance as a
separate decision before investing more in eBay-derived pricing:
- confirm whether written permission exists for average prices;
- otherwise plan to show prices only within the 24-hour window, refreshed, unblended;
- or source prices elsewhere.

Also, `/api/trending-cards` has a hard-coded mock-value fallback (`server/routes.ts:3584-3647`).
Those numbers must never be labelled as eBay prices.

## Order and commits

| Step | Item | Effort |
|---|---|---|
| 1 | D3 attribution line (one commit) | 0.5–1 day |
| 2 | D2 schema + report flow + admin queue | 2–3 days |
| 3 | D1 version table + crop queue + revert (also logs collector-photo overwrites) | 3–4 days |
| | **Total** | **about 6–8 days** |

D1 and D2 share `card_image_versions`. Build it with D1, or first if D2 lands first.
None of this needs the scan flags. Every step publishes only when you choose to.

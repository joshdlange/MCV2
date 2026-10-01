# Backlog

Items agreed with the owner; none are scheduled yet.

## Before main is ever published

- **Review `server/seeds/mergeDuplicateLegacySets.ts`.** Since the live build (`f1d92ca`) it includes
  `repair1994FlairPowerBlast` (`c6113e2`), which deletes duplicate card rows (with admin audit-log
  entries) as part of the startup data-fix seeds, i.e. against production on boot. The owner must
  review it before `main` is published.

## eBay

- **Market Trends listing links are not affiliate-tracked.** `server/ebay-browse-api.ts:90` sends the
  literal placeholder `affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>` in
  `X-EBAY-C-ENDUSERCTX`. Fix it to the real EPN campaign ID in a later release.

## Phase C (visual search in production)

- **Reuse the C0 full-catalog vectors** in the production index wherever the URL and content digest
  match. Download and embed only new or changed images.
- **Embed on save:** every image add or change (admin upload, approved collector photo, crop-queue
  result) embeds that one image when it is saved (single-image path). No catalog-wide batch jobs.

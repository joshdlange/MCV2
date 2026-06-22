---
name: Scan-to-Add Architecture
description: How the Scan to Add card identification feature works — AI model, rate limiting, and DB table
---

# Scan-to-Add Architecture

## AI Model
- Uses **GPT-4o-mini** with vision (`detail: "high"`) via the `openai` npm package
- `OPENAI_API_KEY` must be set as a secret
- If key is missing, vision returns all nulls gracefully (no crash)
- Cost: ~$0.0002–0.0005 per scan (sub-cent)

## Rate Limiting
- Free (SIDE_KICK) users: **10 scans per calendar month**
- SUPER_HERO users: unlimited
- Tracked in `user_scan_logs` table (userId + createdAt), counted per calendar month
- 429 response when limit reached includes `{ limitReached: true, limit: 10 }`

**Why:** Keeps OpenAI costs predictable; incentivizes upgrade.

## Key Files
- `server/services/scanService.ts` — GPT-4o-mini vision call + DB matching logic
- `server/routes.ts` — `GET /api/cards/scan/usage` + `POST /api/cards/scan` (with limit check)
- `client/src/pages/scan.tsx` — idle page shows usage meter; blocks upload if at limit
- `shared/schema.ts` — `userScanLogs` table (created via direct SQL, not db:push — drizzle interactive prompt doesn't accept piped input)

## DB Table
`user_scan_logs (id SERIAL, user_id INTEGER FK users, created_at TIMESTAMP DEFAULT NOW)`
Created directly with SQL (drizzle-kit push prompt is interactive, doesn't accept stdin pipe).

## How to Apply
- Any change to scan limits: update `FREE_SCAN_LIMIT_PER_MONTH` constant in `scanService.ts`
- The `uploadImage` from `./cloudinary` MUST be imported in `routes.ts` — it was missing before and caused silent failures

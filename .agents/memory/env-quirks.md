---
name: Repo tooling quirks (drizzle push, tsc)
description: Non-obvious environment gotchas that waste time — schema push prompts and the missing root tsconfig.
---

# Repo tooling quirks

## `npm run db:push` (drizzle-kit) is interactive and needs a TTY
When the schema has ambiguous changes (e.g. a new table whose name resembles a legacy one),
drizzle-kit prompts "create vs rename" and BLOCKS. Piping a newline into it does NOT satisfy the
prompt (it needs a real TTY), so it hangs/fails in this environment.

**How to apply:** for a purely ADDITIVE change (new table + indexes), create it with raw SQL
(via the code_execution `executeSql` callback) using DDL that matches `shared/schema.ts` exactly —
same column types, nullability, and index names. Because it matches the Drizzle definition, a later
`db:push` sees the DB as already in-sync and won't try to recreate it. Verify columns + indexes
after creating. For destructive changes, prefer `db:push --force` only with explicit user awareness.

## Drizzle push matches unique constraints by NAME, and prompts abort everything
`db:push` compares unique constraints by drizzle's naming convention (`<table>_<col>_unique`).
The prod DB had many legacy Postgres-default names (`<table>_<col>_key`), so push kept prompting
"add constraint … truncate?" — one prompt per run, and on EOF (closed stdin, e.g. the post-merge
script) it ABORTS the whole push, so no queued schema changes apply until every prompt is cleared.

**How to apply:** for each prompt, `ALTER TABLE t RENAME CONSTRAINT t_col_key TO t_col_unique;`
(verify no duplicate rows first). All legacy `_key` unique constraints were renamed July 2026.
**Remaining permanent blocker:** `users.email` has `.unique()` in schema but prod has 4 real
accounts sharing 2 emails (distinct firebase_uids), so `users_email_unique` can never be added
without a user decision (merge/delete accounts or drop `.unique()` from email). Until resolved,
db:push stops at that prompt and applies NOTHING — make schema changes via matching raw SQL instead.

## There is NO root `tsconfig.json`
`npm run check` is just `tsc`, and with no tsconfig in the working dir, tsc prints its help text
(~141 lines) and exits 1 — it does NOT type-check anything. So "check passed/failed" from that
script is meaningless.

**How to apply:**
- Frontend type-check: `./node_modules/.bin/tsc -p client/tsconfig.json --noEmit` (expect a large
  number of PRE-EXISTING errors in unrelated files; grep the output for the specific files you
  changed to see if YOUR edits introduced anything).
- Server (`server/**`) is never type-checked — it runs via `tsx` (transpile-only). Confirm server
  correctness by booting the workflow and exercising the code path, not by tsc.
- Vite `npm run build` does NOT type-check either, so calls to undefined identifiers ship to prod
  silently (real incident: admin image-approvals page crashed after every approve because dead
  `setSelectedSubmission(...)` calls from a removed modal survived a refactor — server 200'd, client
  threw). Symptom pattern "server says success, UI shows error" ⇒ suspect a client-side exception in
  a success handler. Before publishing changes to a page, tsc that page's file specifically.

## TanStack Query default fetcher only uses `queryKey[0]`
The default queryFn in `client/src/lib/queryClient.ts` fetches ONLY the first key segment — it does
NOT join hierarchical keys into a URL. `queryKey: ["/api/things", id]` silently fetches
`/api/things` (the list) and the detail component crashes on the wrong shape.

**How to apply:** every hierarchical/detail query needs an explicit `queryFn` (via `apiRequest`)
that builds the full URL, while KEEPING the array key so prefix invalidation still works. This
caused a would-have-shipped crash once; the architect review caught it.

## E2E-testing authed API routes without a browser
Auth is a strict Firebase `verifyIdToken` — curl alone can't hit authed routes. But you CAN mint a
real session server-side: `admin.createCustomToken(uid)` (FIREBASE_SERVICE_ACCOUNT_KEY) → exchange
at `identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=$VITE_FIREBASE_API_KEY` →
use the returned `idToken` as Bearer. Run the script from the workspace root (not /tmp) so
`firebase-admin` resolves. This gives full runtime verification of authed endpoints despite the
screenshot tool's auth limitation.

## Screenshot tool can't see authed (Firebase) pages
The `app_preview` screenshot tool spins up its OWN headless browser with no Firebase session, so it
always lands on the Login page for auth-gated routes — even though the user's real preview browser
IS logged in (you can see it in the browser console logs). Do NOT keep retrying screenshots of
authed pages; verify those flows via the network/console logs (endpoint responses) instead. The
login screenshot is still useful: it proves unauth users correctly route to Login, not elsewhere.

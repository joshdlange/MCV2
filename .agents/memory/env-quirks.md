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

## Screenshot tool can't see authed (Firebase) pages
The `app_preview` screenshot tool spins up its OWN headless browser with no Firebase session, so it
always lands on the Login page for auth-gated routes — even though the user's real preview browser
IS logged in (you can see it in the browser console logs). Do NOT keep retrying screenshots of
authed pages; verify those flows via the network/console logs (endpoint responses) instead. The
login screenshot is still useful: it proves unauth users correctly route to Login, not elsewhere.

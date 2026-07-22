---
name: Drizzle raw sql array params
description: Passing a JS array into a drizzle sql`` template breaks ANY() — use IN with sql.join instead.
---
Rule: In drizzle-orm raw `sql\`\`` templates, `${jsArray}` is NOT sent as a Postgres array. `WHERE col = ANY(${arr})` fails at runtime with `op ANY/ALL (array) requires array on right side` (error 42809).

**Why:** Drizzle serializes the array parameter in a way node-postgres doesn't hand to Postgres as an array type; discovered when a startup cleanup crashed on `slug = ANY($1)`.

**How to apply:** Use `col IN (${sql.join(arr.map(v => sql\`${v}\`), sql\`, \`)})` for raw-SQL list filters, or Drizzle's `inArray()` in query-builder code. Applies anywhere raw sql templates take list filters (startup fixes, services).

import assert from "node:assert/strict";

// Read-only check against the running development app. No sign-in or data writes.
if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("Development preview domain is required");
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
async function read(path: string) {
  const start = performance.now();
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  const text = await response.text();
  return { data: JSON.parse(text), bytes: Buffer.byteLength(text), ms: Math.round(performance.now() - start) };
}
const masters = await read("/api/main-sets");
const all = await read("/api/card-sets");
const results = [];
for (const slug of ["2026-topps-mint-marvel", "2024-upper-deck-marvel-masterpieces-nahuel-grego"]) {
  const master = masters.data.find((row: any) => row.slug === slug);
  assert.ok(master, `Missing fixture ${slug}`);
  const scoped = await read(`/api/card-sets?mainSetId=${master.id}`);
  const expected = all.data.filter((row: any) => row.mainSetId === master.id);
  assert.deepEqual(scoped.data, expected, "Scoped response must preserve all fields, ordering and subsets");
  assert.ok(scoped.bytes < all.bytes);
  results.push({ slug, subsets: scoped.data.length, bytes: scoped.bytes, ms: scoped.ms,
    payloadReductionPercent: Number((100 * (1 - scoped.bytes / all.bytes)).toFixed(2)) });
}
assert.deepEqual((await read("/api/card-sets?mainSetId=2147483647")).data, []);
for (const query of ["0", "-1", "abc", "1.5", "9007199254740993", "1&mainSetId=2"]) {
  assert.equal((await fetch(`${origin}/api/card-sets?mainSetId=${query}`)).status, 400);
}
console.log(JSON.stringify({ fullCatalog: { subsets: all.data.length, bytes: all.bytes, ms: all.ms }, scoped: results,
  checks: "Exact subset parity, unknown master and six invalid filters passed" }, null, 2));

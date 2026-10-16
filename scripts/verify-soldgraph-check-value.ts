/**
 * Explicit, development-only three-card verification. Real provider searches,
 * bounded to these three identities, using the same cache/fallback as Check Value.
 * No catalog or account edits, no badge grants, no bulk operator.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { SoldgraphCache, soldgraphEnabled } from "../server/pricing/soldgraph-cache";
import { SoldgraphClient } from "../server/pricing/soldgraph-client";

if (process.env.NODE_ENV !== "development" || !process.argv.includes("--execute")) {
  throw new Error("Requires development and explicit --execute");
}
assert.ok(soldgraphEnabled(), "SoldGraph must be enabled");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let calls = 0;
class ObservedClient extends SoldgraphClient {
  async search(query: string) {
    calls++;
    return super.search(query);
  }
}
const service = new SoldgraphCache(pool, new ObservedClient());
try {
  const user = (await pool.query("SELECT id FROM users WHERE plan='SUPER_HERO' AND NOT is_admin ORDER BY id LIMIT 1")).rows[0];
  assert.ok(user, "Requires an existing development SUPER_HERO account");
  for (const id of [557056, 58680, 215355]) {
    // IDs differ across development/production. Never let this diagnostic
    // silently query a different identity after a catalog replacement.
    const expected = id === 557056 ? ["Knull","FF-23"] : id === 58680 ? ["Wolverine","82"] : ["Nick Fury","52"];
    const card = (await pool.query("SELECT name,card_number FROM cards WHERE id=$1 AND archived_at IS NULL",[id])).rows[0];
    assert.deepEqual(card && [card.name,card.card_number],expected);
    const baseline = async () => (await pool.query(
      "SELECT id,avg_price,sales_count,last_fetched FROM card_price_cache WHERE card_id=$1 ORDER BY id", [id])).rows;
    const before = await baseline();
    const previousCalls = calls;
    await service.read(id);
    assert.equal(calls, previousCalls, "ordinary read must not search");
    const price = await service.refreshWithFallback(id, user.id);
    const row = (await pool.query(
      "SELECT query,result,refreshed_at,last_error FROM soldgraph_price_cache WHERE card_id=$1", [id])).rows[0];
    assert.deepEqual(await baseline(), before, "eBay cache must remain unchanged");
    const repeatCalls = calls;
    await service.refreshWithFallback(id, user.id);
    assert.equal(calls, repeatCalls, "repeat must use fresh cache/cooldown");
    const result = row?.result;
    console.log(JSON.stringify({
      cardId: id, baseline: before, called: calls > previousCalls,
      query: row?.query, refreshedAt: row?.refreshed_at, error: row?.last_error,
      upstreamCount: result?.upstreamCount, acceptedCount: result?.acceptedCount,
      usableCount: result?.usableCount, bestOfferExclusions: result?.bestOfferCount,
      upstreamBestOfferCount: result?.upstreamBestOfferCount, median: result?.median,
      acceptedComps: result?.decisions?.filter((d: any) => d.usable),
      final: price, baselineUnchanged: true, repeatMadeNoSearch: true,
    }));
  }
  console.log(JSON.stringify({ totalProviderSearches: calls, scope: "development SUPER_HERO service flow; not signed-in browser QA" }));
} finally {
  await pool.end();
}

import test from "node:test";
import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import { marketRefreshThrottle, ebayBrowseReservations, ebayBrowseAllowance } from "../../shared/schema";

test("pricing guard tables stay declared for schema sync and publishing", () => {
  const tables = [
    [marketRefreshThrottle, "market_refresh_throttle", [
      ["key", "text", true, true], ["started_at", "timestamp with time zone", true, false],
      ["hits", "integer", true, false],
    ]],
    [ebayBrowseReservations, "ebay_browse_reservations", [
      ["id", "bigserial", true, true], ["requested_at", "timestamp with time zone", true, false],
      ["card_id", "integer", false, false], ["run_id", "text", false, false],
    ]],
    [ebayBrowseAllowance, "ebay_browse_allowance", [
      ["id", "integer", true, true], ["remaining", "integer", false, false],
      ["baseline", "bigint", false, false], ["reset_at", "timestamp with time zone", false, false],
      ["captured_at", "timestamp with time zone", false, false],
    ]],
  ] as const;
  for (const [table, name, columns] of tables) {
    const config = getTableConfig(table);
    assert.equal(config.name, name);
    assert.deepEqual(config.columns.map(c => [c.name, c.getSQLType(), c.notNull, c.primary]), columns);
    assert.equal(config.foreignKeys.length, 0);
  }
  assert.ok(marketRefreshThrottle.startedAt.hasDefault);
  assert.ok(ebayBrowseReservations.requestedAt.hasDefault);
  const indexes = getTableConfig(ebayBrowseReservations).indexes;
  assert.deepEqual(indexes.map(i => i.config.name), ["ebay_browse_time"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { SoldgraphClient, safePollUrl, type SoldRow } from "../pricing/soldgraph-client";
import { analyzeSoldRows, buildSoldQueries, type PricingCard } from "../pricing/soldgraph-matching";
import { SoldgraphPilot } from "../pricing/soldgraph-dev";

const card: PricingCard = { id: 1, name: "Knull", cardNumber: "FF-23", year: 2026,
  parent: "2026 Topps Chrome Marvel Comics", subset: "Fanfare Green Speckle Refractor /99",
  variation: null, siblings: ["Fanfare", "Fanfare Purple Speckle Refractor /75"] };
const row = (title: string, changes: Partial<SoldRow> = {}): SoldRow => ({
  id: "123", title, link: "https://www.ebay.com/itm/123", displayed_price: { amount: 60, currency: "USD" },
  displayed_price_range: null, best_offer_accepted: false, displayed_shipping: { amount: 5, currency: "USD" },
  shipping_text: "$5 shipping", sold_date: "2026-09-01", condition: "Used", ...changes,
});
const title = "2026 Topps Chrome Marvel Knull FF-23 Fanfare Green Speckle 55/99";
test("seller wording, punctuation and serial-only parallel evidence", () => {
  for (const text of [title, title.replace("FF-23", "FF23"), title.replace("Green Speckle 55/99", "Insert 07/99")]) {
    assert.equal(analyzeSoldRows(card, [row(text)]).usableCount, 1);
  }
  assert.match(buildSoldQueries(card)[0], /2026 Topps Chrome Marvel Knull FF-23/);
});
test("wrong numbers, years, parallels, lots and grades rejected", () => {
  for (const text of [title.replace("FF-23", "FF-230"), title.replace("2026", "2025"),
    title.replace("Green", "Purple"), title.replace("/99", "/75"), `${title} lot of 2`,
    `${title} PSA 10`, title.replace("Speckle", "Mini-Diamond"), `${title} Sapphire`]) {
    assert.equal(analyzeSoldRows(card, [row(text)]).usableCount, 0, text);
  }
});
test("median uses only usable USD non-offer single prices; no multiplier/shipping", () => {
  const rows = [row(title), row(title, { id: "2", displayed_price: { amount: 100, currency: "USD" } }),
    row(title, { id: "3", best_offer_accepted: true }), row(title, { id: "4", displayed_price_range: {} }),
    row(title, { id: "5", displayed_price: { amount: 10, currency: "SGD" } }), row(title)];
  const result = analyzeSoldRows(card, rows);
  assert.equal(result.median, 80); assert.equal(result.usableCount, 2);
  assert.equal(result.bestOfferCount, 1); assert.equal(result.rejectedCount, 1);
  assert.equal(analyzeSoldRows(card, []).median, null);
  assert.equal(analyzeSoldRows(card, [row(title, { best_offer_accepted: true })]).median, null);
});
test("base excludes Sapphire and refractor; insert allows generic refractor", () => {
  const base = { ...card, subset: "Base", cardNumber: "129" };
  assert.equal(analyzeSoldRows(base, [row("2026 Topps Chrome Marvel Sapphire Knull 129")]).usableCount, 0);
  assert.equal(analyzeSoldRows(base, [row("2026 Topps Chrome Marvel Knull 129 Refractor")]).usableCount, 0);
  assert.equal(analyzeSoldRows({ ...card, subset: "Fanfare" },
    [row("2026 Topps Chrome Marvel Knull FF-23 Fanfare Refractor")]).usableCount, 1);
});
test("poll URLs cannot leak credentials", () => {
  for (const url of ["https://evil.test/v1/jobs/abc", "//evil.test/v1/jobs/abc", "http://api.soldgraph.com/v1/jobs/a",
    "https://user:pass@api.soldgraph.com/v1/jobs/a", "/v1/usage"]) assert.throws(() => safePollUrl(url));
  assert.equal(safePollUrl("/v1/jobs/abc").href, "https://api.soldgraph.com/v1/jobs/abc?wait=20");
});
test("pending 202 -> pending 200 -> complete, bounded polling, safe HTTP errors", async () => {
  let calls = 0;
  const client = new SoldgraphClient((async (_url, options) => {
    assert.equal(options?.redirect, "error");
    assert.equal((options?.headers as any).Authorization, "Bearer test");
    calls++;
    return new Response(JSON.stringify(calls < 3 ? { status: "pending", poll_url: "/v1/jobs/a" } :
      { status: "complete", result: { provider: "ebay", country: "us", data: [] } }), { status: calls === 1 ? 202 : 200 });
  }) as typeof fetch, () => "test");
  await client.search("Knull"); assert.equal(calls, 3);
  for (const status of [401, 429, 500]) {
    await assert.rejects(new SoldgraphClient((async () => new Response("secret", { status })) as typeof fetch,
      () => "test").search("x"), /Soldgraph:/);
  }
  const pending = new SoldgraphClient((async () => new Response(JSON.stringify({
    status: "pending", poll_url: "/v1/jobs/a" }))) as typeof fetch, () => "test");
  await assert.rejects(pending.search("x"), /poll_limit/);
  await assert.rejects(new SoldgraphClient((async () => new Response(JSON.stringify({status:"failed"}))) as typeof fetch,
    () => "test").search("x"), /job_failed/);
  await assert.rejects(new SoldgraphClient(fetch, () => "test", 0).search("x"), /timeout/);
});
test("development guard, concurrent deduplication and disk cache", async () => {
  const prior = process.env.NODE_ENV;
  const directory = await mkdtemp("/tmp/soldgraph-test-");
  let calls = 0;
  const fake = { search: async () => { calls++; return { provider: "ebay", country: "us", data: [] }; } } as unknown as SoldgraphClient;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(new SoldgraphPilot(fake, directory).evaluate(card), /development/);
    process.env.NODE_ENV = "development";
    const pilot = new SoldgraphPilot(fake, directory);
    await Promise.all([pilot.evaluate(card), pilot.evaluate(card)]);
    await new SoldgraphPilot(fake, directory).evaluate(card);
    assert.equal(calls, 1);
  } finally { process.env.NODE_ENV = prior; await rm(directory, { recursive: true, force: true }); }
});

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { SoldgraphClient, type SoldPage } from "./soldgraph-client";
import { analyzeSoldRows, buildSoldQueries, type PricingCard } from "./soldgraph-matching";

export function assertDevelopment() {
  if (process.env.NODE_ENV !== "development") throw new Error("Soldgraph pilot requires NODE_ENV=development");
}

/** Isolated pilot cache: never reads or writes the existing card_price_cache. */
export class SoldgraphPilot {
  private readonly inFlight = new Map<string, Promise<SoldPage>>();
  constructor(
    private readonly client = new SoldgraphClient(),
    private readonly cacheDir = "/tmp/mcv-soldgraph-pilot",
    private readonly ttlMs = 24 * 60 * 60 * 1000,
  ) {}

  private async page(query: string): Promise<SoldPage> {
    assertDevelopment();
    const key = createHash("sha256").update(`v1:us:200:recently_sold:${query}`).digest("hex");
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const task = (async () => {
      const path = `${this.cacheDir}/${key}.json`;
      try {
        const cached = JSON.parse(await readFile(path, "utf8"));
        if (Date.now() - cached.savedAt < this.ttlMs && Array.isArray(cached.page?.data)) return cached.page as SoldPage;
      } catch (error: any) {
        if (error.code !== "ENOENT") throw new Error("Soldgraph pilot cache unreadable; refusing an unplanned paid request");
      }
      const page = await this.client.search(query);
      await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
      await writeFile(`${path}.tmp`, JSON.stringify({ savedAt: Date.now(), page }), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      return page;
    })();
    this.inFlight.set(key, task);
    try { return await task; }
    finally { this.inFlight.delete(key); }
  }

  async evaluate(card: PricingCard, maxQueries = 1) {
    assertDevelopment();
    if (![1, 2, 3].includes(maxQueries)) throw new Error("maxQueries must be 1–3");
    const attempts = [];
    const rows = [];
    for (const query of buildSoldQueries(card).slice(0, maxQueries)) {
      const page = await this.page(query);
      rows.push(...page.data);
      attempts.push({ query, returned: page.data.length, reportedTotal: page.reported_total, collectedAt: page.collected_at });
      if (analyzeSoldRows(card, rows).usableCount > 0) break;
    }
    return { provider: "soldgraph", currency: "USD", card, attempts, ...analyzeSoldRows(card, rows) };
  }
}

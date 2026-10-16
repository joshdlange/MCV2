import { randomUUID } from "node:crypto";

const ORIGIN = "https://api.soldgraph.com";
export interface SoldRow {
  id: string;
  title: string | null;
  link: string;
  displayed_price: { amount: number; currency: string } | null;
  displayed_price_range: unknown;
  best_offer_accepted: boolean;
  displayed_shipping: { amount: number; currency: string } | null;
  shipping_text: string | null;
  sold_date: string | null;
  condition: string | null;
}
export interface SoldPage {
  provider: string;
  country: string;
  query: string;
  count: number;
  reported_total: number;
  collected_at: string;
  data: SoldRow[];
}
export class SoldgraphError extends Error {
  constructor(public readonly code: string) {
    super(`Soldgraph: ${code}`);
  }
}

/** Reject redirects and off-origin poll URLs before attaching any credential. */
export function safePollUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value, ORIGIN); }
  catch { throw new SoldgraphError("invalid_poll_url"); }
  if (url.origin !== ORIGIN || url.username || url.password ||
      !/^\/v1\/jobs\/[a-zA-Z0-9_-]+$/.test(url.pathname) || url.hash) {
    throw new SoldgraphError("invalid_poll_url");
  }
  url.search = "?wait=20";
  return url;
}

export class SoldgraphClient {
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly key: () => string | undefined = () => process.env.SOLDGRAPH_KEY,
    private readonly timeoutMs = 120_000,
  ) {}

  private async request(url: URL, deadline: number, idempotencyKey?: string): Promise<any> {
    const key = this.key();
    if (!key) throw new SoldgraphError("missing_key");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SoldgraphError("timeout");
    try {
      const response = await this.transport(url, {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(25_000, remaining)),
      });
      if (response.status === 401) throw new SoldgraphError("invalid_key");
      if (response.status === 429) throw new SoldgraphError("quota_or_rate_limit");
      if (![200, 202].includes(response.status)) throw new SoldgraphError(`http_${response.status}`);
      // Never log response bodies/errors: providers can echo request details.
      return await response.json();
    } catch (error) {
      if (error instanceof SoldgraphError) throw error;
      if (error instanceof Error && /Timeout|Abort/.test(error.name)) throw new SoldgraphError("timeout");
      throw new SoldgraphError("network_or_invalid_response");
    }
  }

  async search(query: string): Promise<SoldPage> {
    if (!query.trim() || query.length > 200) throw new SoldgraphError("invalid_query");
    const deadline = Date.now() + this.timeoutMs;
    const url = new URL("/v1/ebay/sold", ORIGIN);
    url.search = new URLSearchParams({ q: query, country: "us", count: "200", sort: "recently_sold" }).toString();
    let body = await this.request(url, deadline, randomUUID());
    let pollUrl: URL | undefined;
    for (let attempt = 0; attempt <= 6; attempt++) {
      if (body.status === "complete") {
        const page = body.result;
        if (page?.provider !== "ebay" || page?.country !== "us" ||
            !Array.isArray(page?.data) || page.data.length > 200 ||
            page.data.some((row: any) => !row || typeof row.id !== "string")) {
          throw new SoldgraphError("invalid_result");
        }
        return page;
      }
      if (body.status === "failed") throw new SoldgraphError("job_failed");
      if (body.status !== "pending") throw new SoldgraphError("invalid_status");
      if (attempt === 6) throw new SoldgraphError("poll_limit");
      if (body.poll_url) pollUrl = safePollUrl(body.poll_url);
      if (!pollUrl) throw new SoldgraphError("missing_poll_url");
      body = await this.request(pollUrl, deadline);
    }
    throw new SoldgraphError("poll_limit");
  }

  /** Quota inspection for explicit refresh reservations/operators; never ordinary reads. */
  async usage(): Promise<unknown> {
    return this.request(new URL("/v1/usage", ORIGIN), Date.now() + 25_000);
  }
}

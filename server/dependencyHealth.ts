import type { Express, RequestHandler } from "express";

export interface DependencyHealthOptions {
  checkDatabase: () => Promise<void>;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface DependencyHealthResult {
  checkedAt: number;
  database: "available" | "unavailable";
}

export interface DependencyHealthProbe {
  check(): Promise<DependencyHealthResult>;
  handler: RequestHandler;
}

export function createDependencyHealthProbe({
  checkDatabase,
  timeoutMs = 2_000,
  cacheTtlMs = 2_000,
  now = Date.now,
}: DependencyHealthOptions): DependencyHealthProbe {
  let cached: DependencyHealthResult | undefined;
  let inFlight: Promise<DependencyHealthResult> | undefined;

  const runCheck = async (): Promise<DependencyHealthResult> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        checkDatabase(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Database health check timed out")),
            timeoutMs,
          );
        }),
      ]);
      return { checkedAt: now(), database: "available" };
    } catch {
      return { checkedAt: now(), database: "unavailable" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const check = async (): Promise<DependencyHealthResult> => {
    if (cached && now() - cached.checkedAt < cacheTtlMs) return cached;
    if (!inFlight) {
      inFlight = runCheck()
        .then(result => (cached = result))
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };

  const handler: RequestHandler = async (_req, res) => {
    const result = await check();
    const available = result.database === "available";
    res.setHeader("Cache-Control", "no-store");
    res.status(available ? 200 : 503).json({
      status: available ? "healthy" : "unavailable",
      dependencies: {
        database: result.database,
      },
    });
  };

  return { check, handler };
}

export function createDependencyHealthHandler(
  options: DependencyHealthOptions,
): RequestHandler {
  return createDependencyHealthProbe(options).handler;
}

export function installDependencyHealth(
  app: Express,
  probe: DependencyHealthProbe,
): void {
  app.get("/health/dependencies", probe.handler);
}
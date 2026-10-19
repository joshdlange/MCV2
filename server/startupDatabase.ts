type WarmClient = { query(sql: string): Promise<unknown>; release(): void };

/** Every acquired connection must be released, including partial startup failures. */
export async function warmDatabaseConnections(pool: { connect(): Promise<WarmClient> }, count = 3) {
  const results = await Promise.allSettled(Array.from({ length: count }, async () => {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }));
  return results.filter(r => r.status === 'rejected').length;
}

export function isTransientDatabaseError(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return ['08000', '08001', '08003', '08006', '57P01', '57P02', '57P03', '53300',
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(e?.code ?? '') ||
    /connection (terminated|timeout)|connection terminated due to connection timeout|timeout exceeded when trying to connect/i.test(e?.message ?? '');
}

/** Retry only idempotent startup work, never validation/authentication errors. */
export async function retryStartupDatabase<T>(
  operation: () => Promise<T>,
  wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || !isTransientDatabaseError(error)) throw error;
      console.warn(`[Startup database] Temporary connection failure; retry ${attempt}/2`);
      await wait(attempt * 1000);
    }
  }
}

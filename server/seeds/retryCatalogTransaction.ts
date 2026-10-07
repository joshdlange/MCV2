// PostgreSQL aborts the entire transaction on these errors. Retry the whole
// operation, never just the last statement. Identity/validation failures escape.
export async function retryCatalogTransaction(
  operation: () => Promise<void>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      const code = (error as any)?.code ?? (error as any)?.cause?.code;
      if (!['40P01', '40001'].includes(code) || attempt >= 3) throw error;
      console.warn(`[Catalog seed] Transaction ${code}; retry ${attempt + 1}/3`);
      await wait(500 * 2 ** attempt + Math.floor(Math.random() * 250));
    }
  }
}

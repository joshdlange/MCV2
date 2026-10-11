/** Success requires a fresh backend account, never a cached device plan. */
export async function confirmUpgrade(
  refresh: () => Promise<boolean>,
  signal: AbortSignal,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1500)),
): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (signal.aborted) return false;
    if (await refresh()) return !signal.aborted;
    if (attempt < 11) await wait();
  }
  return false;
}

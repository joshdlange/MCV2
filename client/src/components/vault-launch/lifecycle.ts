export const VAULT_MAX_MS = 4000;

export function isNativeVaultPlatform(capacitor: {
  isNativePlatform(): boolean;
  getPlatform(): string;
}): boolean {
  try {
    return capacitor.isNativePlatform() === true &&
      ['ios', 'android'].includes(capacitor.getPlatform());
  } catch {
    return false;
  }
}

/** One claim per JS/native launch, deliberately not persisted across cold launches. */
export function createLaunchClaim() {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
}

/** Shared by the native gate and dev harness. Deadline includes asset/chunk loading. */
export function guardVaultLaunch(
  finish: () => void,
  host: Pick<Window, 'setTimeout' | 'clearTimeout' | 'addEventListener' | 'removeEventListener' | 'innerWidth' | 'innerHeight'>,
  doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
) {
  let ended = false;
  let timer: number | undefined;
  const clean = () => {
    if (timer !== undefined) host.clearTimeout(timer);
    doc.removeEventListener('visibilitychange', visibility);
    host.removeEventListener('pagehide', end);
    host.removeEventListener('resize', orientation);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    clean();
    finish();
  };
  const visibility = () => { if (doc.hidden) end(); };
  const orientation = () => { if (host.innerWidth > host.innerHeight) end(); };
  timer = host.setTimeout(end, VAULT_MAX_MS);
  doc.addEventListener('visibilitychange', visibility);
  host.addEventListener('pagehide', end);
  host.addEventListener('resize', orientation);
  visibility();
  orientation();
  return () => { ended = true; clean(); };
}
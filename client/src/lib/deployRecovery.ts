const STALE_DEPLOY_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
];

export function isStaleDeployChunkError(error: Error | null | undefined): boolean {
  const message = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return STALE_DEPLOY_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

export function reloadOnceForStaleDeployChunk(error: Error | null | undefined): boolean {
  if (!isStaleDeployChunkError(error) || typeof window === "undefined") return false;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return false;

  try {
    const moduleScript = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
      .map(script => script.src)
      .find(Boolean);
    const recoveryKey = `mcv:deploy-reload:${moduleScript || window.location.pathname}`;
    if (window.sessionStorage.getItem(recoveryKey)) return false;
    window.sessionStorage.setItem(recoveryKey, "1");
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
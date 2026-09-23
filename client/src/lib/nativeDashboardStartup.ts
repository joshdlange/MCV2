/** Warm code, not collector data: authentication still owns all API access. */
export function isNativeDashboardPlatform(platform: { isNativePlatform(): boolean; getPlatform(): string }): boolean {
  try {
    return platform.isNativePlatform() && ['ios', 'android'].includes(platform.getPlatform());
  } catch {
    return false;
  }
}

export function warmNativeDashboard(
  platform: { isNativePlatform(): boolean; getPlatform(): string },
  path: string,
  load: () => Promise<unknown>,
): Promise<unknown> | undefined {
  try {
    if (path !== '/' || !isNativeDashboardPlatform(platform)) return;
    return load();
  } catch {
    return;
  }
}
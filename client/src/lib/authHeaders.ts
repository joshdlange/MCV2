export function createApiHeaders(
  token?: string,
  appPlatform?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (appPlatform) {
    headers["x-app-platform"] = appPlatform;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
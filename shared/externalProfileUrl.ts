const PRIVATE_IPV4_RANGES = [
  /^0\./,
  /^10\./,
  /^100\.(?:6[4-9]|[78]\d|9[0-9]|1[01]\d|12[0-7])\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^192\.0\.0\./,
  /^192\.168\./,
  /^198\.18\./,
  /^198\.19\./,
  /^224\./,
  /^2(?:2[5-9]|3\d|4\d|5[0-5])\./,
];

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "home.arpa" ||
    normalized.endsWith(".home.arpa") ||
    normalized.includes(":")
  ) {
    return true;
  }

  return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalized));
}

export function normalizeExternalProfileUrl(
  value: unknown,
  allowedDomains?: readonly string[],
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048) return null;

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || isBlockedHostname(parsed.hostname)) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
      allowedDomains &&
      !allowedDomains.some((domain) => {
        const normalizedDomain = domain.toLowerCase();
        return (
          hostname === normalizedDomain ||
          hostname.endsWith(`.${normalizedDomain}`)
        );
      })
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}
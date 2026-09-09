const TRUSTED_AVATAR_DOMAINS = [
  "googleusercontent.com",
  "storage.googleapis.com",
  "firebasestorage.googleapis.com",
  "res.cloudinary.com",
] as const;

const TRUSTED_LOCAL_PREFIXES = [
  "/assets/",
  "/src/assets/",
  "/uploads/",
] as const;

export function normalizeTrustedAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2_048) return null;

  if (raw.startsWith("/") && !raw.startsWith("//")) {
    try {
      const parsed = new URL(raw, "https://app.invalid");
      if (
        parsed.origin === "https://app.invalid" &&
        TRUSTED_LOCAL_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
      ) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const trusted = TRUSTED_AVATAR_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    return trusted ? parsed.toString() : null;
  } catch {
    return null;
  }
}
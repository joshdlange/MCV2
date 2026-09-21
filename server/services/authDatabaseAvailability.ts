import crypto from "node:crypto";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

const DATABASE_AVAILABILITY_CODES = new Set([
  "28000",
  "28P01",
  "53300",
  "53400",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
]);

export const DATABASE_UNAVAILABLE_RESPONSE = {
  message: "Database temporarily unavailable. Please retry.",
  code: "DATABASE_UNAVAILABLE",
  retryable: true,
} as const;

export function isDatabaseUnavailableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as ErrorLike;
    const code = typeof candidate.code === "string" ? candidate.code : "";
    if (code.startsWith("08") || DATABASE_AVAILABILITY_CODES.has(code)) return true;

    const message =
      typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
    if (
      message.includes("endpoint has been disabled") ||
      message.includes("connection terminated") ||
      message.includes("connection timeout") ||
      message.includes("database system is starting up") ||
      message.includes("database health check timed out")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export function hashInternalIdentity(identity: string): string {
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export class AuthDatabaseAvailabilityTracker {
  private outageObserved = false;

  constructor(
    private readonly writeLog: (record: Record<string, unknown>) => void =
      record => console.error(JSON.stringify(record)),
  ) {}

  failure(requestId: string, firebaseUid: string, error: unknown): void {
    this.outageObserved = true;
    const code =
      error && typeof error === "object" && typeof (error as ErrorLike).code === "string"
        ? (error as ErrorLike).code
        : undefined;
    this.writeLog({
      event: "auth_sync_database_unavailable",
      requestId,
      identityHash: hashInternalIdentity(firebaseUid),
      ...(code ? { databaseErrorCode: code } : {}),
    });
  }

  recovery(requestId: string, firebaseUid: string): void {
    if (!this.outageObserved) return;
    this.outageObserved = false;
    this.writeLog({
      event: "auth_sync_database_recovered",
      requestId,
      identityHash: hashInternalIdentity(firebaseUid),
    });
  }
}
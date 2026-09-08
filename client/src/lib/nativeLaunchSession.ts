import { Capacitor } from "@capacitor/core";

export interface NativeLaunchSession {
  sessionId: string;
  platform: "android" | "ios";
}

let currentNativeLaunch: NativeLaunchSession | undefined;

function createSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns one stable identifier for this native app process. Reusing it across
 * auth callbacks and manual sync retries lets the server count one cold launch
 * exactly once.
 */
export function getNativeLaunchSession(
  platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web",
): NativeLaunchSession | undefined {
  if (platform !== "android" && platform !== "ios") return undefined;
  if (!currentNativeLaunch) {
    currentNativeLaunch = {
      sessionId: createSessionId(),
      platform,
    };
  }
  return currentNativeLaunch;
}
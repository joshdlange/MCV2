import type { Express } from "express";

type DataFixGateState = "pending" | "ready" | "failed";

function isProtectedWrite(method: string, path: string): boolean {
  return method !== "GET"
    && method !== "HEAD"
    && method !== "OPTIONS"
    && /^\/api\/(collection|wishlist|pc-binders|cards|listings|marketplace|scan)(\/|$)/.test(path);
}

export function installDataFixWriteGate(app: Express) {
  let state: DataFixGateState = "pending";

  app.use((req, res, next) => {
    if (state !== "ready" && isProtectedWrite(req.method, req.path)) {
      const failed = state === "failed";
      return res.status(503).json({
        message: failed
          ? "The Vault could not complete a required data update. Card changes are temporarily paused."
          : "The Vault is finishing a quick data update — please try again in a moment.",
        code: failed ? "DATA_UPDATE_FAILED" : "DATA_UPDATE_PENDING",
      });
    }
    next();
  });

  return {
    markReady() {
      state = "ready";
    },
    markFailed() {
      state = "failed";
    },
    get state(): DataFixGateState {
      return state;
    },
  };
}
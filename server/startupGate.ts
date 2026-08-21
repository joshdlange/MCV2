import type { Express } from "express";

const STARTUP_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta http-equiv="refresh" content="2" />
    <title>Marvelous Card Vault is updating</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 20%, rgba(220, 38, 38, .24), transparent 32rem),
          #09090b;
        color: #fafafa;
      }
      main { width: min(32rem, calc(100vw - 2rem)); text-align: center; padding: 2rem; }
      .mark {
        width: 4rem;
        height: 4rem;
        margin: 0 auto 1.25rem;
        display: grid;
        place-items: center;
        border: 2px solid #ef4444;
        border-radius: 999px;
        color: #f87171;
        font-size: 1.75rem;
        font-weight: 900;
        box-shadow: 0 0 2rem rgba(220, 38, 38, .28);
      }
      h1 { margin: 0; font-size: clamp(1.4rem, 5vw, 2rem); }
      p { margin: .75rem 0 0; color: #a1a1aa; line-height: 1.5; }
      .bar {
        width: 12rem;
        height: .25rem;
        margin: 1.5rem auto 0;
        overflow: hidden;
        border-radius: 999px;
        background: #27272a;
      }
      .bar::after {
        content: "";
        display: block;
        width: 45%;
        height: 100%;
        border-radius: inherit;
        background: #dc2626;
        animation: load 1.1s ease-in-out infinite alternate;
      }
      @keyframes load { from { transform: translateX(-10%); } to { transform: translateX(135%); } }
      @media (prefers-reduced-motion: reduce) { .bar::after { animation: none; width: 100%; } }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">V</div>
      <h1>The Vault is updating</h1>
      <p>A fresh version is coming online. This page will reconnect automatically.</p>
      <div class="bar" aria-label="Starting"></div>
    </main>
  </body>
</html>`;

export interface StartupGate {
  markReady(): void;
  isReady(): boolean;
}

export function installStartupGate(app: Express): StartupGate {
  let ready = false;

  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      status: ready ? "healthy" : "starting",
      ready,
      message: ready
        ? "Marvelous Card Vault API is running"
        : "Marvelous Card Vault is starting",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    });
  });

  app.get("/ready", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(ready ? 200 : 503).json({ ready });
  });

  app.get("/", (_req, res, next) => {
    if (ready) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "2");
    return res.status(200).type("html").send(STARTUP_PAGE);
  });

  app.use("/api", (_req, res, next) => {
    if (ready) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "2");
    return res.status(503).json({
      message: "The Vault is updating. Please retry in a moment.",
      code: "APP_STARTING",
    });
  });

  // Browser deep links (for example /feed or /collection) must receive the
  // same handoff as /. Without this gate, Express can finish the request with
  // a plain 404 before the SPA catch-all is registered.
  app.use((req, res, next) => {
    if (ready) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "2");

    if ((req.method === "GET" || req.method === "HEAD") && req.accepts("html")) {
      return res.status(200).type("html").send(STARTUP_PAGE);
    }

    return res.status(503).json({
      message: "The Vault is updating. Please retry in a moment.",
      code: "APP_STARTING",
    });
  });

  return {
    markReady() {
      ready = true;
    },
    isReady() {
      return ready;
    },
  };
}
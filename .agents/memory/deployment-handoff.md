---
name: Zero-error deployment handoff
description: Startup and stale-client constraints that prevent generic error pages during a Replit publish.
---

Open the production HTTP listener before database warm-up, startup migrations, seeds, route registration, or other expensive initialization. Until initialization finishes, liveness must stay available, the root must serve an auto-refreshing update page, and API traffic must receive a controlled retryable 503. Mark the app ready only after API routes and SPA serving are installed.

**Why:** Replit sends health traffic to a newly starting instance before the old deployment handoff is complete. Waiting to listen until all startup work finishes produced a burst of generic 500 pages for users on every publish. Browsers already open during a publish can also request hashed chunks from the previous build, so deployment-shaped chunk failures need one guarded automatic reload.

**How to apply:** Keep new startup work behind the readiness gate rather than moving it before the listener. Preserve immediate `/health`, readiness signaling, early hashed-asset serving, retry headers, and the one-reload-per-build/session guard for dynamic-import failures. Ordinary application errors must continue to use the normal error boundary.
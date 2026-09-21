import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import {
  createDependencyHealthProbe,
  installDependencyHealth,
} from "../dependencyHealth";
import { installStartupGate } from "../startupGate";

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition");
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

test("dependency health coalesces checks, caches briefly, and reports outages safely", async () => {
  const app = express();
  let checks = 0;
  let available = false;
  let releaseCheck: (() => void) | undefined;
  const probe = createDependencyHealthProbe({
    cacheTtlMs: 100,
    timeoutMs: 100,
    checkDatabase: async () => {
      checks += 1;
      await new Promise<void>(resolve => {
        releaseCheck = resolve;
      });
      if (!available) throw Object.assign(new Error("secret endpoint detail"), { code: "28000" });
    },
  });
  installDependencyHealth(app, probe);
  const listening = await listen(app);

  try {
    const requests = [
      fetch(`${listening.origin}/health/dependencies`),
      fetch(`${listening.origin}/health/dependencies`),
    ];
    await waitFor(() => checks === 1 && Boolean(releaseCheck));
    assert.equal(checks, 1);
    releaseCheck?.();

    for (const response of await Promise.all(requests)) {
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        status: "unavailable",
        dependencies: { database: "unavailable" },
      });
    }

    const cached = await fetch(`${listening.origin}/health/dependencies`);
    assert.equal(cached.status, 503);
    assert.equal(checks, 1);

    await new Promise(resolve => setTimeout(resolve, 110));
    available = true;
    releaseCheck = undefined;
    const recoveredRequest = fetch(`${listening.origin}/health/dependencies`);
    await waitFor(() => checks === 2 && Boolean(releaseCheck));
    releaseCheck?.();
    const recovered = await recoveredRequest;
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).dependencies.database, "available");
    assert.equal(checks, 2);
  } finally {
    await listening.close();
  }
});

test("readiness includes database health after startup while liveness stays independent", async () => {
  const app = express();
  let databaseAvailable = false;
  const probe = createDependencyHealthProbe({
    cacheTtlMs: 0,
    checkDatabase: async () => {
      if (!databaseAvailable) throw Object.assign(new Error("disabled"), { code: "28000" });
    },
  });
  installDependencyHealth(app, probe);
  const gate = installStartupGate(app, {
    checkDependencies: async () => (await probe.check()).database === "available",
  });
  gate.markReady();
  const listening = await listen(app);

  try {
    const liveDuringOutage = await fetch(`${listening.origin}/health`);
    assert.equal(liveDuringOutage.status, 200);
    const liveBody = await liveDuringOutage.json();
    assert.equal(liveBody.status, "alive");
    assert.equal(liveBody.startupComplete, true);
    assert.equal("ready" in liveBody, false);

    const unready = await fetch(`${listening.origin}/ready`);
    assert.equal(unready.status, 503);
    assert.deepEqual(await unready.json(), { ready: false });

    databaseAvailable = true;
    const ready = await fetch(`${listening.origin}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ready: true });
  } finally {
    await listening.close();
  }
});
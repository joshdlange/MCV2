import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { installDataFixWriteGate } from "../dataFixWriteGate";
import { installStartupGate } from "../startupGate";

test("startup gate serves a recoverable page, then passes through when ready", async () => {
  const app = express();
  const gate = installStartupGate(app);
  app.get("/", (_req, res) => res.status(200).send("APP_READY"));
  app.get("/feed", (_req, res) => res.status(200).send("FEED_READY"));
  app.get("/api/probe", (_req, res) => res.status(200).json({ ok: true }));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const startingRoot = await fetch(`${origin}/`);
    assert.equal(startingRoot.status, 200);
    assert.match(await startingRoot.text(), /Vault is updating/i);
    assert.equal(startingRoot.headers.get("cache-control"), "no-store");
    assert.equal(startingRoot.headers.get("retry-after"), "2");

    const startingDeepLink = await fetch(`${origin}/feed`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(startingDeepLink.status, 200);
    assert.match(await startingDeepLink.text(), /Vault is updating/i);

    const startingApi = await fetch(`${origin}/api/probe`);
    assert.equal(startingApi.status, 503);
    assert.deepEqual(await startingApi.json(), {
      message: "The Vault is updating. Please retry in a moment.",
      code: "APP_STARTING",
    });

    const startingHealth = await fetch(`${origin}/health`);
    assert.equal(startingHealth.status, 200);
    assert.equal((await startingHealth.json()).ready, false);

    const startingReady = await fetch(`${origin}/ready`);
    assert.equal(startingReady.status, 503);

    gate.markReady();

    const readyRoot = await fetch(`${origin}/`);
    assert.equal(readyRoot.status, 200);
    assert.equal(await readyRoot.text(), "APP_READY");

    const readyDeepLink = await fetch(`${origin}/feed`);
    assert.equal(readyDeepLink.status, 200);
    assert.equal(await readyDeepLink.text(), "FEED_READY");

    const readyApi = await fetch(`${origin}/api/probe`);
    assert.equal(readyApi.status, 200);
    assert.deepEqual(await readyApi.json(), { ok: true });

    const readyHealth = await fetch(`${origin}/health`);
    assert.equal((await readyHealth.json()).ready, true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test("required data-fix failure keeps card-reference writes blocked", async () => {
  const app = express();
  const gate = installDataFixWriteGate(app);
  app.get("/api/collection", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/collection", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/marketplace/listings", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/auth/sync", (_req, res) => res.status(200).json({ ok: true }));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const pendingWrite = await fetch(`${origin}/api/collection`, { method: "POST" });
    assert.equal(pendingWrite.status, 503);
    assert.equal((await pendingWrite.json()).code, "DATA_UPDATE_PENDING");

    const allowedRead = await fetch(`${origin}/api/collection`);
    assert.equal(allowedRead.status, 200);

    gate.markFailed();
    assert.equal(gate.state, "failed");
    const failedCollectionWrite = await fetch(`${origin}/api/collection`, { method: "POST" });
    assert.equal(failedCollectionWrite.status, 503);
    assert.equal((await failedCollectionWrite.json()).code, "DATA_UPDATE_FAILED");
    const failedMarketplaceWrite = await fetch(`${origin}/api/marketplace/listings`, { method: "POST" });
    assert.equal(failedMarketplaceWrite.status, 503);
    assert.equal((await failedMarketplaceWrite.json()).code, "DATA_UPDATE_FAILED");

    const unrelatedWrite = await fetch(`${origin}/api/auth/sync`, { method: "POST" });
    assert.equal(unrelatedWrite.status, 200);

    gate.markReady();
    const readyWrite = await fetch(`${origin}/api/collection`, { method: "POST" });
    assert.equal(readyWrite.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
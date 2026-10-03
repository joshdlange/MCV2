import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { devScanUndoMatches, registerDevScanUxRoutes } from "../devScanUxRoutes";

test("DEV undo accepts only the exact newly inserted row snapshot", () => {
  const row = { id: 73, userId: 18, cardId: 951, quantity: 1, notes: null, isFavorite: false, isForSale: false, acquiredDate: new Date("2026-01-01") };
  const capability = { userId: 18, rowId: 73, snapshot: JSON.stringify(row), expires: 2000 };
  assert.equal(devScanUndoMatches(capability, row, 18, 73, 1000), true);
  assert.equal(devScanUndoMatches(capability, row, 19, 73, 1000), false, "Other user");
  assert.equal(devScanUndoMatches(capability, row, 18, 951, 1000), false, "Card ID is never the owned row ID");
  assert.equal(devScanUndoMatches(capability, row, 18, 73, 2001), false, "Expired undo");
  assert.equal(devScanUndoMatches(capability, null, 18, 73, 1000), false, "Already removed");
  for (const delta of [{ quantity: 2 }, { notes: "Changed elsewhere" }, { isFavorite: true }, { isForSale: true }, { cardId: 952 }, { acquiredDate: new Date("2026-01-02") }]) {
    assert.equal(devScanUndoMatches(capability, { ...row, ...delta }, 18, 73, 1000), false, "Never undo any later changes");
  }
});

test("Visual-off UX endpoints reject before auth or any database access", async () => {
  const app = express();
  app.use(express.json());
  let authCalls = 0;
  registerDevScanUxRoutes(app, (_req, _res, next) => { authCalls++; next(); }, () => false);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const [method, route] of [["POST", "/api/cards/scan/collection"], ["DELETE", "/api/cards/scan/collection/73"], ["GET", "/api/cards/scan/search?q=1"]]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method });
      assert.equal(response.status, 404);
    }
    assert.equal(authCalls, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
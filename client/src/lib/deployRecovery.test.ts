import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleDeployChunkError } from "./deployRecovery";

test("recognizes stale deployment chunk failures without swallowing normal app errors", () => {
  const recoverable = [
    new Error("Failed to fetch dynamically imported module: https://example.com/assets/Feed-old.js"),
    Object.assign(new Error("Loading chunk 847 failed"), { name: "ChunkLoadError" }),
    new Error("Importing a module script failed."),
    new Error("Unable to preload CSS for /assets/app-old.css"),
  ];
  for (const error of recoverable) {
    assert.equal(isStaleDeployChunkError(error), true, error.message);
  }

  assert.equal(isStaleDeployChunkError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isStaleDeployChunkError(null), false);
});
import assert from "node:assert/strict";
import test from "node:test";
import { createApiHeaders } from "./authHeaders";

test("authenticated API headers never include user-controlled profile fields", () => {
  const headers = createApiHeaders("ascii.firebase.jwt", "web");

  assert.deepEqual(headers, {
    "Content-Type": "application/json",
    "x-app-platform": "web",
    Authorization: "Bearer ascii.firebase.jwt",
  });
  assert.doesNotThrow(() => new Headers(headers));

  for (const unsafeHeader of [
    "x-firebase-uid",
    "x-user-email",
    "x-display-name",
    "x-photo-url",
    "x-user-name",
  ]) {
    assert.equal(headers[unsafeHeader], undefined);
  }
});
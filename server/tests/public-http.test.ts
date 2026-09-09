import test from "node:test";
import assert from "node:assert/strict";

import { isUnsafePublicHttpAddress } from "../services/publicHttp";

test("server-side public HTTP downloads reject private and IPv6 destinations", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "fe80::1",
  ]) {
    assert.equal(isUnsafePublicHttpAddress(address), true, address);
  }
  assert.equal(isUnsafePublicHttpAddress("8.8.8.8"), false);
});
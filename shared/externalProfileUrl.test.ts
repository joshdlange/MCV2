import test from "node:test";
import assert from "node:assert/strict";

import { normalizeExternalProfileUrl } from "./externalProfileUrl";

test("normalizes ordinary profile URLs to HTTPS", () => {
  assert.equal(
    normalizeExternalProfileUrl("example.com/collector"),
    "https://example.com/collector",
  );
});

test("rejects executable and credential-bearing URLs", () => {
  assert.equal(normalizeExternalProfileUrl("javascript:alert(1)"), null);
  assert.equal(normalizeExternalProfileUrl("https://user:pass@example.com"), null);
});

test("rejects local and private-network destinations", () => {
  assert.equal(normalizeExternalProfileUrl("http://localhost:3000"), null);
  assert.equal(normalizeExternalProfileUrl("http://127.0.0.1"), null);
  assert.equal(normalizeExternalProfileUrl("http://192.168.1.10"), null);
  assert.equal(normalizeExternalProfileUrl("http://device.local"), null);
  assert.equal(normalizeExternalProfileUrl("http://[::1]"), null);
  assert.equal(normalizeExternalProfileUrl("http://[::]"), null);
  assert.equal(normalizeExternalProfileUrl("http://[::ffff:127.0.0.1]"), null);
  assert.equal(normalizeExternalProfileUrl("http://[fe80::1]"), null);
});

test("requires exact or subdomain matches for branded profile links", () => {
  assert.equal(
    normalizeExternalProfileUrl(
      "https://www.instagram.com/marvelcardvault",
      ["instagram.com"],
    ),
    "https://www.instagram.com/marvelcardvault",
  );
  assert.equal(
    normalizeExternalProfileUrl(
      "https://instagram.com.attacker.example/marvelcardvault",
      ["instagram.com"],
    ),
    null,
  );
});
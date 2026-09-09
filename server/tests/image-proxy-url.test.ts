import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProxiedImageUrl } from "../image-proxy";
import { isSafeRasterContentType } from "../services/imageMigration";

test("accepts exact and subdomain matches from the image allowlist", () => {
  assert.equal(
    normalizeProxiedImageUrl("https://images.pricecharting.com/example.jpg"),
    "https://images.pricecharting.com/example.jpg",
  );
  assert.equal(
    normalizeProxiedImageUrl("https://i.ebayimg.com/images/example.jpg"),
    "https://i.ebayimg.com/images/example.jpg",
  );
});

test("rejects substring, credential, and non-HTTP allowlist bypasses", () => {
  assert.equal(
    normalizeProxiedImageUrl("https://images.pricecharting.com.attacker.example/image.jpg"),
    null,
  );
  assert.equal(
    normalizeProxiedImageUrl("https://attacker.example/image.jpg?from=ebayimg.com"),
    null,
  );
  assert.equal(
    normalizeProxiedImageUrl("https://user:password@i.ebayimg.com/image.jpg"),
    null,
  );
  assert.equal(normalizeProxiedImageUrl("file:///etc/passwd"), null);
});

test("converts only exact Google Drive file URLs", () => {
  assert.equal(
    normalizeProxiedImageUrl("https://drive.google.com/file/d/abc_123/view"),
    "https://drive.google.com/uc?export=view&id=abc_123",
  );
  assert.equal(
    normalizeProxiedImageUrl("https://drive.google.com.attacker.example/file/d/abc_123/view"),
    null,
  );
});

test("untrusted image downloads exclude script-capable SVG documents", () => {
  assert.equal(isSafeRasterContentType("image/png"), true);
  assert.equal(isSafeRasterContentType("image/webp; charset=binary"), true);
  assert.equal(isSafeRasterContentType("image/svg+xml"), false);
  assert.equal(isSafeRasterContentType("text/html"), false);
});
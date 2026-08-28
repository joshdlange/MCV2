import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicImageUrl, resolvePublicImageRedirect } from "../services/imageMigration";

test("Image Admin URLs reject local, private, and unsupported destinations", async () => {
  const blocked = [
    "ftp://example.com/card.jpg",
    "http://localhost/card.jpg",
    "http://127.0.0.1/card.jpg",
    "http://10.0.0.1/card.jpg",
    "http://169.254.169.254/latest/meta-data",
    "http://192.0.2.1/card.jpg",
    "http://198.51.100.1/card.jpg",
    "http://203.0.113.1/card.jpg",
    "http://224.0.0.1/card.jpg",
    "http://[::1]/card.jpg",
    "http://[::7f00:1]/card.jpg",
    "http://[fec0::1]/card.jpg",
    "http://[ff02::1]/card.jpg",
  ];

  for (const url of blocked) {
    await assert.rejects(() => assertPublicImageUrl(url), undefined, url);
  }
});

test("Image Admin URLs accept a public HTTPS image destination", async () => {
  const parsed = await assertPublicImageUrl("https://example.com/card.jpg");
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "example.com");
});

test("Image Admin redirect validation rejects a redirect to a private destination", async () => {
  await assert.rejects(
    () => resolvePublicImageRedirect("https://example.com/card.jpg", "http://169.254.169.254/latest/meta-data"),
    /not allowed/,
  );
});
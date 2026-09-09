import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTrustedAvatarUrl } from "./trustedAvatarUrl";

test("avatar URLs are limited to controlled HTTPS origins or app assets", () => {
  assert.equal(
    normalizeTrustedAvatarUrl("https://lh3.googleusercontent.com/a/avatar"),
    "https://lh3.googleusercontent.com/a/avatar",
  );
  assert.equal(
    normalizeTrustedAvatarUrl("https://res.cloudinary.com/mcv/image/upload/avatar.webp"),
    "https://res.cloudinary.com/mcv/image/upload/avatar.webp",
  );
  assert.equal(normalizeTrustedAvatarUrl("/assets/avatar.webp"), "/assets/avatar.webp");
  assert.equal(normalizeTrustedAvatarUrl("/src/assets/avatars/avatar.webp"), "/src/assets/avatars/avatar.webp");
  assert.equal(normalizeTrustedAvatarUrl("/uploads/avatar.webp"), "/uploads/avatar.webp");
});

test("avatar URLs reject local aliases, arbitrary hosts, and allowlist spoofing", () => {
  assert.equal(normalizeTrustedAvatarUrl("http://localtest.me/avatar.png"), null);
  assert.equal(normalizeTrustedAvatarUrl("https://localtest.me/avatar.png"), null);
  assert.equal(normalizeTrustedAvatarUrl("https://googleusercontent.com.attacker.test/a"), null);
  assert.equal(normalizeTrustedAvatarUrl("https://attacker.test/?x=res.cloudinary.com"), null);
  assert.equal(normalizeTrustedAvatarUrl("//127.0.0.1/avatar.png"), null);
  assert.equal(normalizeTrustedAvatarUrl("https://user:pass@lh3.googleusercontent.com/a"), null);
});
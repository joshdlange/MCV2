import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";

import {
  InvalidAppleIdentityTokenError,
  verifyAppleIdentityToken,
} from "../services/appleIdentityToken";

const audience = "com.marvelcardvault.app";
const issuer = "https://appleid.apple.com";
const rawNonce = "test-raw-nonce";
const hashedNonce = createHash("sha256").update(rawNonce).digest("hex");

async function signAppleToken(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
  overrides: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "apple-user-123",
    email: "collector@example.test",
    email_verified: "true",
    nonce: hashedNonce,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

test("accepts a correctly signed Apple identity token", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signAppleToken(privateKey);

  const identity = await verifyAppleIdentityToken(token, rawNonce, publicKey);
  assert.deepEqual(identity, {
    appleUserId: "apple-user-123",
    email: "collector@example.test",
  });
});

test("rejects a token signed by an untrusted key", async () => {
  const trusted = await generateKeyPair("RS256");
  const attacker = await generateKeyPair("RS256");
  const token = await signAppleToken(attacker.privateKey);

  await assert.rejects(
    verifyAppleIdentityToken(token, rawNonce, trusted.publicKey),
    InvalidAppleIdentityTokenError,
  );
});

test("rejects the wrong audience", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: "apple-user-123",
    nonce: hashedNonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience("attacker.example")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);

  await assert.rejects(
    verifyAppleIdentityToken(token, rawNonce, publicKey),
    InvalidAppleIdentityTokenError,
  );
});

test("requires the nonce to match", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await signAppleToken(privateKey);

  await assert.rejects(
    verifyAppleIdentityToken(token, "different-raw-nonce", publicKey),
    InvalidAppleIdentityTokenError,
  );
});
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_AUDIENCE = "com.marvelcardvault.app";
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

type AppleVerificationKey = Parameters<typeof jwtVerify>[1];

export class InvalidAppleIdentityTokenError extends Error {
  constructor() {
    super("Invalid Apple identity token");
    this.name = "InvalidAppleIdentityTokenError";
  }
}

export interface VerifiedAppleIdentity {
  appleUserId: string;
  email: string | null;
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string,
  verificationKey: AppleVerificationKey = APPLE_JWKS,
): Promise<VerifiedAppleIdentity> {
  try {
    const expectedNonce = createHash("sha256")
      .update(rawNonce)
      .digest("hex");
    const { payload } = await jwtVerify(identityToken, verificationKey, {
      issuer: APPLE_ISSUER,
      audience: APPLE_AUDIENCE,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp", "nonce"],
      clockTolerance: 5,
    });

    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.nonce !== expectedNonce
    ) {
      throw new InvalidAppleIdentityTokenError();
    }

    const emailVerified =
      payload.email_verified === true ||
      payload.email_verified === "true";
    const email =
      emailVerified && typeof payload.email === "string"
        ? payload.email
        : null;

    return {
      appleUserId: payload.sub,
      email,
    };
  } catch (error) {
    if (error instanceof InvalidAppleIdentityTokenError) {
      throw error;
    }
    throw new InvalidAppleIdentityTokenError();
  }
}
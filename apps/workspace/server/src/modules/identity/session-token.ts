import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { NewPasswordUser } from "./identity.repository.js";
import type { SessionIssuedFor } from "./identity.types.js";
import type { WriteSource } from "./write-source.js";

export function createSessionToken(
  createdAt: number,
  expiresAt: number,
  writeSource: WriteSource,
  issuedFor?: SessionIssuedFor
): {
  readonly cookieValue: string;
  readonly stored: NewPasswordUser["session"];
} {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return {
    cookieValue: `${id}.${secret}`,
    stored: {
      id,
      secretHash: hashSessionSecret(secret),
      createdAt,
      expiresAt,
      writeSource,
      ...(issuedFor ? { issuedFor } : {}),
    },
  };
}

export function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSessionSecret(secret), "base64url");
  const expected = Buffer.from(expectedHash, "base64url");
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

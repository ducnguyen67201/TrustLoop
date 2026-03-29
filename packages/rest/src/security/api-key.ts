import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@shared/env";

const API_KEY_PREFIX = "tlk";

function hashApiKeySecret(fullSecret: string): string {
  return createHmac("sha256", env.API_KEY_PEPPER).update(fullSecret).digest("hex");
}

/**
 * Build a workspace API key and hash pair, where the secret is only shown once.
 */
export function generateWorkspaceApiKeyMaterial(): {
  keyPrefix: string;
  fullSecret: string;
  secretHash: string;
} {
  const prefixPart = randomBytes(6).toString("hex");
  const secretPart = randomBytes(24).toString("hex");
  const keyPrefix = `${API_KEY_PREFIX}_${prefixPart}`;
  const fullSecret = `${keyPrefix}.${secretPart}`;

  return {
    keyPrefix,
    fullSecret,
    secretHash: hashApiKeySecret(fullSecret),
  };
}

/**
 * Extract the API key prefix from a presented secret.
 */
export function extractApiKeyPrefix(fullSecret: string): string | null {
  const [prefix] = fullSecret.split(".");
  if (!prefix || !prefix.startsWith(`${API_KEY_PREFIX}_`)) {
    return null;
  }

  return prefix;
}

/**
 * Constant-time verification for API key secret comparison.
 */
export function verifyApiKeySecret(fullSecret: string, expectedSecretHash: string): boolean {
  const actualHash = hashApiKeySecret(fullSecret);
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedSecretHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

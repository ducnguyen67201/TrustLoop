import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@shared/env";

// AES-256-GCM secret encryption. One canonical helper for all server-side
// encrypted secrets in TrustLoop. Used today for MCP bearer tokens; existing
// Slack/GitHub OAuth tokens get migrated to this helper in a follow-up PR.
//
// Format: "v1:<keyId>:<iv-base64>:<ciphertext-base64>:<authTag-base64>".
// Single-string blob. The keyId encodes which key encrypted the value so a
// future rotation can re-encrypt rows under a new key without losing the
// ability to read older rows during the transition.
//
// Storage: callers persist the blob string. To find rows under a given key
// version (for rotation sweeps), filter with `startsWith("v1:<keyId>:")`.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const DEFAULT_KEY_ID = "default";

const ENC_PATTERN = /^v1:([^:]+):([^:]+):([^:]+):([^:]+)$/;

function getKey(keyId: string): Buffer {
  if (keyId !== DEFAULT_KEY_ID) {
    throw new Error(
      `secret-encryption: unknown keyId "${keyId}". Only "${DEFAULT_KEY_ID}" is wired in v1; rotation runbook must add additional keys.`
    );
  }
  const b64 = env.SECRET_ENCRYPTION_KEY;
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `secret-encryption: SECRET_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). Regenerate with: npx tsx scripts/dev/gen-encryption-key.ts`
    );
  }
  return key;
}

export function encrypt(plaintext: string, keyId: string = DEFAULT_KEY_ID): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("secret-encryption: plaintext must be a non-empty string");
  }
  const key = getKey(keyId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}:${keyId}:${iv.toString("base64")}:${encrypted.toString("base64")}:${authTag.toString("base64")}`;
}

export function decrypt(blob: string): string {
  const match = ENC_PATTERN.exec(blob);
  if (!match) {
    throw new Error(
      "secret-encryption: malformed ciphertext blob (expected v1:<keyId>:<iv>:<ct>:<tag>)"
    );
  }
  const [, keyId, ivB64, ctB64, tagB64] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const key = getKey(keyId);
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new Error(`secret-encryption: IV must be ${IV_LENGTH} bytes (got ${iv.length})`);
  }
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `secret-encryption: auth tag must be ${AUTH_TAG_LENGTH} bytes (got ${tag.length})`
    );
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function getKeyVersion(blob: string): string {
  const match = ENC_PATTERN.exec(blob);
  if (!match) {
    throw new Error("secret-encryption: malformed ciphertext blob");
  }
  return match[1] as string;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && ENC_PATTERN.test(value);
}

// Constant-time string equality for places where a plaintext secret must be
// compared to user input. Re-export so callers don't pull node:crypto directly.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

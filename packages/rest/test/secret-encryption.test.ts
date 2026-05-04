import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TEST_KEY = randomBytes(32).toString("base64");

vi.mock("@shared/env", () => ({
  env: { SECRET_ENCRYPTION_KEY: TEST_KEY },
}));

let secretEncryption: typeof import("../src/security/secret-encryption.js");

beforeAll(async () => {
  secretEncryption = await import("../src/security/secret-encryption.js");
});

describe("secret-encryption", () => {
  it("encrypts and decrypts a round-trip", () => {
    const plaintext = "tlk_my-secret-bearer-token-1234567890";
    const blob = secretEncryption.encrypt(plaintext);
    expect(blob).toMatch(/^v1:default:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(secretEncryption.decrypt(blob)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plaintext = "same-input";
    const a = secretEncryption.encrypt(plaintext);
    const b = secretEncryption.encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(secretEncryption.decrypt(a)).toBe(plaintext);
    expect(secretEncryption.decrypt(b)).toBe(plaintext);
  });

  it("rejects empty plaintext", () => {
    expect(() => secretEncryption.encrypt("")).toThrow(/non-empty string/);
  });

  it("rejects malformed ciphertext", () => {
    expect(() => secretEncryption.decrypt("not-a-blob")).toThrow(/malformed/);
    expect(() => secretEncryption.decrypt("v1:default:short:short:short")).toThrow();
  });

  it("rejects tampered ciphertext (auth tag mismatch)", () => {
    const blob = secretEncryption.encrypt("hello world");
    const parts = blob.split(":");
    expect(parts).toHaveLength(5);
    const ct = Buffer.from(parts[3] as string, "base64");
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => secretEncryption.decrypt(parts.join(":"))).toThrow();
  });

  it("rejects unknown keyId", () => {
    const blob = secretEncryption.encrypt("data");
    const parts = blob.split(":");
    parts[1] = "rotated-v2";
    expect(() => secretEncryption.decrypt(parts.join(":"))).toThrow(/unknown keyId/);
  });

  it("getKeyVersion returns the keyId", () => {
    const blob = secretEncryption.encrypt("anything");
    expect(secretEncryption.getKeyVersion(blob)).toBe("default");
  });

  it("isEncrypted accepts well-formed blobs and rejects others", () => {
    const blob = secretEncryption.encrypt("anything");
    expect(secretEncryption.isEncrypted(blob)).toBe(true);
    expect(secretEncryption.isEncrypted("plaintext")).toBe(false);
    expect(secretEncryption.isEncrypted(null)).toBe(false);
    expect(secretEncryption.isEncrypted(undefined)).toBe(false);
    expect(secretEncryption.isEncrypted(42)).toBe(false);
  });

  it("constantTimeEqual matches identical strings and rejects differing ones", () => {
    expect(secretEncryption.constantTimeEqual("abc", "abc")).toBe(true);
    expect(secretEncryption.constantTimeEqual("abc", "abd")).toBe(false);
    expect(secretEncryption.constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

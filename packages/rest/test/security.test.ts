import {
  extractApiKeyPrefix,
  generateWorkspaceApiKeyMaterial,
  verifyApiKeySecret,
} from "@shared/rest/security/api-key";
import { hasRequiredRole } from "@shared/rest/security/rbac";
import { describe, expect, it } from "vitest";

describe("rbac", () => {
  it("allows owner/admin/member role ordering checks", () => {
    expect(hasRequiredRole("OWNER", "ADMIN")).toBe(true);
    expect(hasRequiredRole("ADMIN", "MEMBER")).toBe(true);
    expect(hasRequiredRole("MEMBER", "ADMIN")).toBe(false);
    expect(hasRequiredRole(null, "MEMBER")).toBe(false);
  });
});

describe("workspace api key security", () => {
  it("generates prefix + secret that validates against stored hash", () => {
    const key = generateWorkspaceApiKeyMaterial();

    expect(key.keyPrefix.startsWith("tlk_")).toBe(true);
    expect(extractApiKeyPrefix(key.fullSecret)).toBe(key.keyPrefix);
    expect(verifyApiKeySecret(key.fullSecret, key.secretHash)).toBe(true);
  });

  it("rejects malformed or mismatched api key secrets", () => {
    const key = generateWorkspaceApiKeyMaterial();

    expect(extractApiKeyPrefix("bad-format")).toBeNull();
    expect(verifyApiKeySecret(`${key.fullSecret}x`, key.secretHash)).toBe(false);
  });
});

import {
  extractApiKeyPrefix,
  generateWorkspaceApiKeyMaterial,
  verifyApiKeySecret,
} from "@shared/rest/security/api-key";
import {
  canAssignWorkspaceRole,
  canManageWorkspaceMember,
  hasRequiredRole,
} from "@shared/rest/security/rbac";
import { describe, expect, it } from "vitest";

describe("rbac", () => {
  it("allows owner/admin/member role ordering checks", () => {
    expect(hasRequiredRole("OWNER", "ADMIN")).toBe(true);
    expect(hasRequiredRole("ADMIN", "MEMBER")).toBe(true);
    expect(hasRequiredRole("MEMBER", "ADMIN")).toBe(false);
    expect(hasRequiredRole(null, "MEMBER")).toBe(false);
  });

  it("applies role assignment rules", () => {
    expect(canAssignWorkspaceRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignWorkspaceRole("OWNER", "MEMBER")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "ADMIN")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "MEMBER")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignWorkspaceRole("MEMBER", "MEMBER")).toBe(false);
    expect(canAssignWorkspaceRole(null, "MEMBER")).toBe(false);
  });

  it("applies member management hierarchy", () => {
    expect(canManageWorkspaceMember("OWNER", "ADMIN", false)).toBe(true);
    expect(canManageWorkspaceMember("OWNER", "MEMBER", false)).toBe(true);
    expect(canManageWorkspaceMember("OWNER", "OWNER", false)).toBe(false);
    expect(canManageWorkspaceMember("ADMIN", "MEMBER", false)).toBe(true);
    expect(canManageWorkspaceMember("ADMIN", "ADMIN", false)).toBe(false);
    expect(canManageWorkspaceMember("ADMIN", "OWNER", false)).toBe(false);
    expect(canManageWorkspaceMember("ADMIN", "MEMBER", true)).toBe(false);
    expect(canManageWorkspaceMember("MEMBER", "MEMBER", false)).toBe(false);
    expect(canManageWorkspaceMember(null, "MEMBER", false)).toBe(false);
  });
});

describe("workspace api key security", () => {
  it("generates prefix + secret that validates against stored hash", () => {
    const key = generateWorkspaceApiKeyMaterial();

    expect(key.keyPrefix.startsWith("tlk_")).toBe(true);
    expect(key.keyPrefix.length).toBeGreaterThan(20);
    expect(key.fullSecret.length).toBeGreaterThan(100);
    expect(extractApiKeyPrefix(key.fullSecret)).toBe(key.keyPrefix);
    expect(verifyApiKeySecret(key.fullSecret, key.secretHash)).toBe(true);
  });

  it("rejects malformed or mismatched api key secrets", () => {
    const key = generateWorkspaceApiKeyMaterial();

    expect(extractApiKeyPrefix("bad-format")).toBeNull();
    expect(verifyApiKeySecret(`${key.fullSecret}x`, key.secretHash)).toBe(false);
  });
});

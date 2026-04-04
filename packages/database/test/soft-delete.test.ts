import { describe, expect, it } from "vitest";
import { SOFT_DELETE_MODELS } from "../src/soft-delete";

describe("SOFT_DELETE_MODELS", () => {
  const tier1Models = [
    "User",
    "Workspace",
    "WorkspaceMembership",
    "WorkspaceApiKey",
    "SupportInstallation",
    "SupportConversation",
    "SupportDeliveryAttempt",
    "SupportTicketLink",
  ];

  const tier2Models = ["Session", "SupportIngressEvent"];

  const tier3Models = [
    "AuditLog",
    "SupportConversationEvent",
    "SupportDeadLetter",
  ];

  it("includes all Tier 1 models", () => {
    for (const model of tier1Models) {
      expect(SOFT_DELETE_MODELS).toContain(model);
    }
  });

  it("has exactly 8 models", () => {
    expect(SOFT_DELETE_MODELS).toHaveLength(8);
  });

  it("does not include Tier 2 models (hard delete)", () => {
    for (const model of tier2Models) {
      expect(SOFT_DELETE_MODELS).not.toContain(model);
    }
  });

  it("does not include Tier 3 models (never delete)", () => {
    for (const model of tier3Models) {
      expect(SOFT_DELETE_MODELS).not.toContain(model);
    }
  });
});

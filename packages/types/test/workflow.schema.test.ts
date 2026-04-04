import { workflowDispatchSchema } from "@shared/types/workflow.schema";
import { describe, expect, it } from "vitest";

describe("workflowDispatchSchema", () => {
  it("accepts support dispatch payload", () => {
    const parsed = workflowDispatchSchema.parse({
      type: "support",
      payload: {
        workspaceId: "ws_1",
        installationId: "inst_1",
        ingressEventId: "evt_1",
        canonicalIdempotencyKey: "key_1",
      },
    });

    expect(parsed.type).toBe("support");
  });

  it("rejects invalid codex payload", () => {
    const result = workflowDispatchSchema.safeParse({
      type: "codex",
      payload: {
        analysisId: "analysis_1",
        repositoryId: "repo_1",
        pullRequestNumber: 0,
      },
    });

    expect(result.success).toBe(false);
  });
});

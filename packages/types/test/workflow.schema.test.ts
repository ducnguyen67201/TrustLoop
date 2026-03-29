import { workflowDispatchSchema } from "@shared/types/workflow.schema";
import { describe, expect, it } from "vitest";

describe("workflowDispatchSchema", () => {
  it("accepts support dispatch payload", () => {
    const parsed = workflowDispatchSchema.parse({
      type: "support",
      payload: {
        threadId: "thread_123",
        workspaceId: "ws_1",
        requesterId: "user_1",
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

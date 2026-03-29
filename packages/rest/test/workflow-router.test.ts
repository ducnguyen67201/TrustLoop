import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import { describe, expect, it, vi } from "vitest";

function createDispatcher(): WorkflowDispatcher {
  return {
    startSupportWorkflow: vi.fn(async () => ({
      workflowId: "support-pipeline-thread_1",
      runId: "run_support_1",
      queue: "support-general",
    })),
    startCodexWorkflow: vi.fn(async () => ({
      workflowId: "fix-pr-analysis_1",
      runId: "run_codex_1",
      queue: "codex-intensive",
    })),
  };
}

describe("dispatchWorkflow", () => {
  it("routes support payloads to support dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "support",
      payload: {
        threadId: "thread_1",
        workspaceId: "ws_1",
        requesterId: "user_1",
      },
    });

    expect(result.workflowId).toContain("support-pipeline");
    expect(dispatcher.startSupportWorkflow).toHaveBeenCalledTimes(1);
  });

  it("routes codex payloads to codex dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "codex",
      payload: {
        analysisId: "analysis_1",
        repositoryId: "repo_1",
        pullRequestNumber: 42,
      },
    });

    expect(result.workflowId).toContain("fix-pr");
    expect(dispatcher.startCodexWorkflow).toHaveBeenCalledTimes(1);
  });
});

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
    startRepositoryIndexWorkflow: vi.fn(async () => ({
      workflowId: "repository-index-sync_1",
      runId: "run_repository_index_1",
      queue: "codex-intensive",
    })),
    startSupportAnalysisWorkflow: vi.fn(async () => ({
      workflowId: "support-analysis-conv_1-1700000000",
      runId: "run_analysis_1",
      queue: "support-general",
    })),
    startCodexWorkflow: vi.fn(async () => ({
      workflowId: "fix-pr-analysis_1",
      runId: "run_codex_1",
      queue: "codex-intensive",
    })),
    startSendDraftToSlackWorkflow: vi.fn(async () => ({
      workflowId: "send-draft-draft_1",
      runId: "run_send_draft_1",
      queue: "support-general",
    })),
  };
}

describe("dispatchWorkflow", () => {
  it("routes support payloads to support dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "support",
      payload: {
        workspaceId: "ws_1",
        installationId: "inst_1",
        ingressEventId: "evt_1",
        canonicalIdempotencyKey: "inst_1:team_1:channel_1:12345.0001:message",
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

  it("routes repository index payloads to the codex indexing dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "repository-index",
      payload: {
        syncRequestId: "sync_1",
        workspaceId: "ws_1",
        repositoryId: "repo_1",
      },
    });

    expect(result.workflowId).toContain("repository-index");
    expect(dispatcher.startRepositoryIndexWorkflow).toHaveBeenCalledTimes(1);
  });

  it("routes support-analysis payloads to analysis dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "support-analysis",
      payload: {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        triggerType: "MANUAL" as const,
      },
    });

    expect(result.workflowId).toContain("support-analysis");
    expect(dispatcher.startSupportAnalysisWorkflow).toHaveBeenCalledTimes(1);
  });
});

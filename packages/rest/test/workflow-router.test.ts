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
    startSupportSummaryWorkflow: vi.fn(async () => ({
      workflowId: "support-summary-conv_1",
      runId: "run_summary_1",
      queue: "support-general",
    })),
    startAgentTeamRunWorkflow: vi.fn(async () => ({
      workflowId: "agent-team-run-run_1",
      runId: "run_agent_team_1",
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

  it("routes agent-team-run payloads to the dedicated dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "agent-team-run",
      payload: {
        workspaceId: "ws_1",
        runId: "run_1",
        teamId: "team_1",
        threadSnapshot: "thread snapshot",
        teamSnapshot: {
          roles: [
            {
              id: "role_1",
              teamId: "team_1",
              roleKey: "architect",
              slug: "architect",
              label: "Architect",
              provider: "openai",
              toolIds: ["searchCode"],
              maxSteps: 6,
              sortOrder: 0,
            },
          ],
          edges: [],
        },
      },
    });

    expect(result.workflowId).toContain("agent-team-run");
    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledTimes(1);
  });

  it("routes support-summary payloads to summary dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "support-summary",
      payload: {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        triggerReason: "INGRESS" as const,
      },
    });

    expect(result.workflowId).toContain("support-summary");
    expect(dispatcher.startSupportSummaryWorkflow).toHaveBeenCalledTimes(1);
  });
});

import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import type { ThreadSnapshot } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

const threadSnapshot: ThreadSnapshot = {
  conversationId: "conv_1",
  channelId: "C0ABCDEF",
  threadTs: "1776616233.348399",
  status: "UNREAD",
  customer: { email: null },
  events: [
    {
      type: "MESSAGE_RECEIVED",
      source: "CUSTOMER",
      summary: "thread snapshot",
      details: { rawText: "thread snapshot" },
      at: "2026-04-19T16:30:34.672Z",
    },
  ],
};

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
    startAgentTeamRunResumeWorkflow: vi.fn(async () => ({
      workflowId: "agent-team-run-run_1-resume-1",
      runId: "run_agent_team_resume_1",
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

  it("routes agent-team-run payloads to the dedicated dispatcher", async () => {
    const dispatcher = createDispatcher();

    const result = await dispatchWorkflow(dispatcher, {
      type: "agent-team-run",
      payload: {
        workspaceId: "ws_1",
        runId: "run_1",
        teamId: "team_1",
        teamConfig: "FAST",
        threadSnapshot,
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

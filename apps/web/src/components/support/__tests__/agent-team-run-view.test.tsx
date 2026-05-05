import type { AgentTeamRunSummary } from "@shared/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentTeamRunView } from "../agent-team-run-view";

afterEach(() => {
  cleanup();
});

function buildRunSummary(): AgentTeamRunSummary {
  return {
    id: "run_1",
    workspaceId: "ws_1",
    teamId: "team_1",
    conversationId: "conv_1",
    analysisId: null,
    teamConfig: "DEEP",
    runtimeVersion: "harness_v2",
    ledgerOutcome: null,
    status: "running",
    workflowId: "workflow_1",
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    messages: [
      {
        id: "msg_1",
        runId: "run_1",
        threadId: "thread_1",
        fromRoleKey: "architect",
        fromRoleSlug: "architect",
        fromRoleLabel: "Architect",
        toRoleKey: "reviewer",
        kind: "proposal",
        subject: "Review this fix",
        content: "Please challenge the null-guard proposal.",
        parentMessageId: null,
        refs: [],
        toolName: null,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ],
    roleInboxes: [
      {
        id: "inbox_1",
        runId: "run_1",
        roleKey: "reviewer",
        state: "queued",
        lastReadMessageId: null,
        wakeReason: "architect:proposal:Review this fix",
        unreadCount: 1,
        lastWokenAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    facts: [
      {
        id: "fact_1",
        runId: "run_1",
        statement: "Slack reply threading fails before parent lookup.",
        confidence: 0.92,
        sourceMessageIds: ["msg_1"],
        acceptedByRoleKeys: ["architect"],
        status: "accepted",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    openQuestions: [
      {
        id: "question_1",
        runId: "run_1",
        askedByRoleKey: "architect",
        ownerRoleKey: "reviewer",
        question: "Can reviewer confirm regression coverage?",
        blockingRoleKeys: ["reviewer"],
        status: "open",
        sourceMessageId: "msg_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

describe("AgentTeamRunView", () => {
  it("renders dialogue, facts, questions, and inboxes for a run", () => {
    render(
      <AgentTeamRunView
        error={null}
        isLoading={false}
        isMutating={false}
        isStreaming={false}
        onStartRun={vi.fn()}
        run={buildRunSummary()}
      />
    );

    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText(/Review this fix/i)).toBeTruthy();

    const factsTab = screen.getByRole("tab", { name: /Facts/ });
    fireEvent.mouseDown(factsTab);
    fireEvent.click(factsTab);
    expect(screen.getByText(/Slack reply threading fails/i)).toBeTruthy();

    const questionsTab = screen.getByRole("tab", { name: /Questions/ });
    fireEvent.mouseDown(questionsTab);
    fireEvent.click(questionsTab);
    expect(screen.getByText(/regression coverage/i)).toBeTruthy();

    const inboxesTab = screen.getByRole("tab", { name: /Inboxes/ });
    fireEvent.mouseDown(inboxesTab);
    fireEvent.click(inboxesTab);
    expect(screen.getByText(/architect:proposal:Review this fix/i)).toBeTruthy();
  });

  it("keeps hook order stable when a run appears after the empty state", () => {
    const { rerender } = render(
      <AgentTeamRunView
        error={null}
        isLoading={false}
        isMutating={false}
        isStreaming={false}
        onStartRun={vi.fn()}
        run={null}
      />
    );

    rerender(
      <AgentTeamRunView
        error={null}
        isLoading={false}
        isMutating={false}
        isStreaming={false}
        onStartRun={vi.fn()}
        run={buildRunSummary()}
      />
    );

    expect(screen.getByText("running")).toBeTruthy();
  });

  it("disables the re-run button while a run is streaming so rapid clicks cannot spawn concurrent paid runs", () => {
    const onStartRun = vi.fn();
    render(
      <AgentTeamRunView
        error={null}
        isLoading={false}
        isMutating={false}
        isStreaming={true}
        onStartRun={onStartRun}
        run={buildRunSummary()}
      />
    );

    const button = screen.getByRole("button", { name: /Re-run/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("labels empty serialized tool results instead of rendering raw quotes", () => {
    const run = buildRunSummary();
    render(
      <AgentTeamRunView
        error={null}
        isLoading={false}
        isMutating={false}
        isStreaming={false}
        onStartRun={vi.fn()}
        run={{
          ...run,
          messages: [
            {
              id: "tool_1",
              runId: "run_1",
              threadId: "thread_1",
              fromRoleKey: "architect",
              fromRoleSlug: "architect",
              fromRoleLabel: "Architect",
              toRoleKey: "broadcast",
              kind: "tool_result",
              subject: "unknown result",
              content: '""',
              parentMessageId: null,
              refs: [],
              toolName: "unknown",
              metadata: null,
              createdAt: new Date().toISOString(),
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByText(/tool_result/));
    expect(screen.getByText("(empty tool output)")).toBeTruthy();
  });
});

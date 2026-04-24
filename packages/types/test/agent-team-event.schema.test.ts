import {
  AGENT_TEAM_EVENT_ACTOR_SYSTEM,
  AGENT_TEAM_EVENT_KIND,
  AGENT_TEAM_MESSAGE_KIND,
  agentTeamEventKindSchema,
  agentTeamRunEventDraftSchema,
  agentTeamRunEventSchema,
  agentTeamRunRollupSchema,
} from "@shared/types";
import { describe, expect, it } from "vitest";

describe("agent team event schema", () => {
  it("exposes every event kind as a stable string", () => {
    expect(AGENT_TEAM_EVENT_KIND.runStarted).toBe("run_started");
    expect(AGENT_TEAM_EVENT_KIND.messageSent).toBe("message_sent");
    expect(AGENT_TEAM_EVENT_KIND.toolReturned).toBe("tool_returned");
    expect(AGENT_TEAM_EVENT_KIND.error).toBe("error");
  });

  it("accepts every declared kind in the enum schema", () => {
    for (const kind of Object.values(AGENT_TEAM_EVENT_KIND)) {
      expect(agentTeamEventKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects unknown event kinds", () => {
    expect(agentTeamEventKindSchema.safeParse("not_a_kind").success).toBe(false);
  });
});

describe("agentTeamRunEventDraftSchema", () => {
  it("accepts a run_started draft without latency/tokens", () => {
    const draft = agentTeamRunEventDraftSchema.parse({
      kind: AGENT_TEAM_EVENT_KIND.runStarted,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: AGENT_TEAM_EVENT_ACTOR_SYSTEM.orchestrator,
      payload: { teamId: "team_1" },
    });
    expect(draft.kind).toBe("run_started");
  });

  it("accepts a message_sent draft with target + messageKind", () => {
    const draft = agentTeamRunEventDraftSchema.parse({
      kind: AGENT_TEAM_EVENT_KIND.messageSent,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: "architect",
      target: "reviewer",
      messageKind: AGENT_TEAM_MESSAGE_KIND.hypothesis,
      payload: {
        messageId: "msg_1",
        fromRoleKey: "architect",
        toRoleKey: "reviewer",
        kind: AGENT_TEAM_MESSAGE_KIND.hypothesis,
        subject: "root cause",
        contentPreview: "Null deref at checkout.ts:47",
      },
    });
    if (draft.kind !== AGENT_TEAM_EVENT_KIND.messageSent) throw new Error("unreachable");
    expect(draft.payload.messageId).toBe("msg_1");
  });

  it("accepts a tool_returned draft with latencyMs", () => {
    const draft = agentTeamRunEventDraftSchema.parse({
      kind: AGENT_TEAM_EVENT_KIND.toolReturned,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: "architect",
      latencyMs: 180,
      payload: { toolName: "searchCode", ok: true, resultSummary: "2 hits" },
    });
    if (draft.kind !== AGENT_TEAM_EVENT_KIND.toolReturned) throw new Error("unreachable");
    expect(draft.latencyMs).toBe(180);
  });

  it("rejects a message_sent draft missing messageKind", () => {
    const result = agentTeamRunEventDraftSchema.safeParse({
      kind: AGENT_TEAM_EVENT_KIND.messageSent,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: "architect",
      payload: {
        messageId: "msg_1",
        fromRoleKey: "architect",
        toRoleKey: "reviewer",
        kind: AGENT_TEAM_MESSAGE_KIND.hypothesis,
        subject: "root cause",
        contentPreview: "...",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence > 1 on fact_proposed", () => {
    const result = agentTeamRunEventDraftSchema.safeParse({
      kind: AGENT_TEAM_EVENT_KIND.factProposed,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: "reviewer",
      payload: { factId: "f_1", statement: "x", confidence: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

describe("agentTeamRunEventSchema (persisted row)", () => {
  it("round-trips every kind from a DB-shaped row", () => {
    const baseRow = {
      id: "evt_1",
      runId: "run_1",
      workspaceId: "ws_1",
      ts: new Date("2026-04-14T12:00:00Z"),
      actor: "architect",
      truncated: false,
    };
    const happyCases = [
      {
        ...baseRow,
        kind: AGENT_TEAM_EVENT_KIND.runStarted,
        payload: { teamId: "team_1" },
      },
      {
        ...baseRow,
        kind: AGENT_TEAM_EVENT_KIND.roleCompleted,
        latencyMs: 3200,
        tokensIn: 1200,
        tokensOut: 800,
        payload: { roleKey: "architect" },
      },
      {
        ...baseRow,
        kind: AGENT_TEAM_EVENT_KIND.error,
        payload: { message: "timeout", recoverable: true },
      },
    ];
    for (const row of happyCases) {
      const parsed = agentTeamRunEventSchema.parse(row);
      expect(parsed.kind).toBe(row.kind);
    }
  });

  it("rejects a row with mismatched payload shape for its kind", () => {
    const result = agentTeamRunEventSchema.safeParse({
      id: "evt_1",
      runId: "run_1",
      workspaceId: "ws_1",
      ts: new Date(),
      actor: "architect",
      kind: AGENT_TEAM_EVENT_KIND.toolCalled,
      payload: { teamId: "team_1" },
    });
    expect(result.success).toBe(false);
  });
});

describe("agentTeamRunRollupSchema", () => {
  it("validates a per-role rollup with totals", () => {
    const summary = agentTeamRunRollupSchema.parse({
      runId: "run_1",
      status: "completed",
      startedAt: new Date("2026-04-14T12:00:00Z"),
      completedAt: new Date("2026-04-14T12:02:47Z"),
      durationMs: 167_000,
      messageCount: 12,
      toolCallCount: 4,
      tokensInTotal: 9_100,
      tokensOutTotal: 9_100,
      perRole: [
        {
          roleKey: "architect",
          turns: 5,
          toolCalls: 0,
          tokensIn: 3_900,
          tokensOut: 3_900,
          wallTimeMs: 52_000,
        },
      ],
      computedAt: new Date("2026-04-14T12:02:47Z"),
    });
    expect(summary.perRole[0]?.turns).toBe(5);
  });
});

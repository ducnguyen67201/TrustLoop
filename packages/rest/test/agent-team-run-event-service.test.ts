import {
  AGENT_TEAM_EVENT_ACTOR_SYSTEM,
  AGENT_TEAM_EVENT_KIND,
  AGENT_TEAM_MESSAGE_KIND,
} from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Row shape matches the Prisma-generated one so parseEvent can round-trip it.
interface EventRowLike {
  id: string;
  runId: string;
  workspaceId: string;
  ts: Date;
  actor: string;
  kind: string;
  target: string | null;
  messageKind: string | null;
  payload: unknown;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  truncated: boolean;
}

let nextId = 0;
let nextTs = new Date("2026-04-14T12:00:00.000Z").getTime();

function issueRow(data: Record<string, unknown>): EventRowLike {
  nextId += 1;
  nextTs += 1;
  return {
    id: `evt_${nextId}`,
    ts: new Date(nextTs),
    runId: String(data.runId ?? ""),
    workspaceId: String(data.workspaceId ?? ""),
    actor: String(data.actor ?? ""),
    kind: String(data.kind ?? ""),
    target: (data.target as string | null) ?? null,
    messageKind: (data.messageKind as string | null) ?? null,
    payload: data.payload ?? {},
    latencyMs: (data.latencyMs as number | null) ?? null,
    tokensIn: (data.tokensIn as number | null) ?? null,
    tokensOut: (data.tokensOut as number | null) ?? null,
    truncated: Boolean(data.truncated),
  };
}

const mockCreateManyAndReturn = vi.fn(async ({ data }: { data: Record<string, unknown>[] }) =>
  data.map((d) => issueRow(d))
);

// Mocked client. Cast through unknown because the Prisma-generated type is
// enormous; the test only exercises createManyAndReturn.
const fakeClient = {
  agentTeamRunEvent: {
    createManyAndReturn: mockCreateManyAndReturn,
  },
} as unknown as import("@shared/rest/services/agent-team/run-event-service").EventClient;

vi.mock("@shared/database", () => ({
  prisma: {
    agentTeamRunEvent: {
      createManyAndReturn: mockCreateManyAndReturn,
    },
  },
}));

const runEventService = await import("@shared/rest/services/agent-team/run-event-service");

describe("recordEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextId = 0;
  });

  it("persists a run_started event and returns the parsed row", async () => {
    const event = await runEventService.recordEvent(fakeClient, {
      kind: AGENT_TEAM_EVENT_KIND.runStarted,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: AGENT_TEAM_EVENT_ACTOR_SYSTEM.orchestrator,
      payload: { teamId: "team_1" },
    });
    expect(mockCreateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(event.kind).toBe(AGENT_TEAM_EVENT_KIND.runStarted);
    if (event.kind !== AGENT_TEAM_EVENT_KIND.runStarted) throw new Error("unreachable");
    expect(event.payload.teamId).toBe("team_1");
    expect(event.id).toMatch(/^evt_/);
  });

  it("persists a message_sent event with target + messageKind", async () => {
    const event = await runEventService.recordEvent(fakeClient, {
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
    expect(event.target).toBe("reviewer");
    expect(event.messageKind).toBe(AGENT_TEAM_MESSAGE_KIND.hypothesis);
  });

  it("persists a tool_returned event with latencyMs", async () => {
    const event = await runEventService.recordEvent(fakeClient, {
      kind: AGENT_TEAM_EVENT_KIND.toolReturned,
      runId: "run_1",
      workspaceId: "ws_1",
      actor: "architect",
      latencyMs: 180,
      payload: { toolName: "searchCode", ok: true, resultSummary: "2 hits" },
    });
    expect(event.latencyMs).toBe(180);
  });
});

describe("recordEvents (batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextId = 0;
  });

  it("returns an empty array for empty input without hitting Prisma", async () => {
    const result = await runEventService.recordEvents(fakeClient, []);
    expect(result).toHaveLength(0);
    expect(mockCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("persists a batch of mixed-kind events in one round-trip", async () => {
    const events = await runEventService.recordEvents(fakeClient, [
      {
        kind: AGENT_TEAM_EVENT_KIND.toolCalled,
        runId: "run_1",
        workspaceId: "ws_1",
        actor: "architect",
        payload: { toolName: "searchCode", argsPreview: "q=session.userId" },
      },
      {
        kind: AGENT_TEAM_EVENT_KIND.toolReturned,
        runId: "run_1",
        workspaceId: "ws_1",
        actor: "architect",
        latencyMs: 142,
        payload: { toolName: "searchCode", ok: true, resultSummary: "2 hits" },
      },
    ]);
    expect(mockCreateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe(AGENT_TEAM_EVENT_KIND.toolCalled);
    expect(events[1]?.kind).toBe(AGENT_TEAM_EVENT_KIND.toolReturned);
  });
});

describe("logRecordedEvents", () => {
  it("emits one JSONL line per event to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    runEventService.logRecordedEvents([
      {
        id: "evt_1",
        runId: "run_1",
        workspaceId: "ws_1",
        ts: new Date("2026-04-14T12:00:00Z"),
        actor: "architect",
        kind: AGENT_TEAM_EVENT_KIND.toolCalled,
        target: null,
        messageKind: null,
        latencyMs: null,
        tokensIn: null,
        tokensOut: null,
        truncated: false,
        payload: { toolName: "searchCode", argsPreview: "q=x" },
      },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] ?? [];
    expect(typeof line).toBe("string");
    expect(String(line)).toMatch(/"runId":"run_1"/);
    expect(String(line)).toMatch(/"kind":"tool_called"/);
    expect(String(line)).toMatch(/\n$/);
    spy.mockRestore();
  });

  it("never throws when stdout.write fails", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() =>
      runEventService.logRecordedEvents([
        {
          id: "evt_1",
          runId: "run_1",
          workspaceId: "ws_1",
          ts: new Date(),
          actor: "architect",
          kind: AGENT_TEAM_EVENT_KIND.runStarted,
          target: null,
          messageKind: null,
          latencyMs: null,
          tokensIn: null,
          tokensOut: null,
          truncated: false,
          payload: { teamId: "team_1" },
        },
      ])
    ).not.toThrow();
    spy.mockRestore();
  });
});

describe("parseEvent", () => {
  it("rejects a DB row with a payload shape that mismatches its kind", () => {
    expect(() =>
      runEventService.parseEvent({
        id: "evt_1",
        runId: "run_1",
        workspaceId: "ws_1",
        ts: new Date(),
        actor: "architect",
        kind: AGENT_TEAM_EVENT_KIND.toolCalled,
        target: null,
        messageKind: null,
        latencyMs: null,
        tokensIn: null,
        tokensOut: null,
        truncated: false,
        payload: { teamId: "team_1" },
      })
    ).toThrow();
  });
});

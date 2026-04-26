import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for closeAsNoAction service. Two paths matter most:
//   1. Staleness guard rejects when a customer message landed after the
//      agent-team run completed (prevents "operator clicks close on stale
//      blocked-state run while the customer's actual follow-up sits in queue").
//   2. Happy path transitions the conversation to DONE via the
//      operatorCloseAsNoAction FSM event and writes a STATUS_CHANGED event
//      with reason: no_action_taken.

const mockRequireConversation = vi.fn();
const mockConvFindUniqueOrThrow = vi.fn();
const mockRunFindFirst = vi.fn();
const mockEventFindFirst = vi.fn();
const mockConvUpdate = vi.fn();
const mockEventCreate = vi.fn();
const mockTransaction = vi.fn();
const mockRealtimeEmit = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@shared/rest/services/support/support-command/_shared", () => ({
  requireConversation: (...args: unknown[]) => mockRequireConversation(...args),
  buildCommandResponse: (commandId: string) => ({
    accepted: true as const,
    commandId,
    workflowId: null,
  }),
}));

vi.mock("@shared/rest/services/support/support-realtime-service", () => ({
  emitConversationChanged: (...args: unknown[]) => mockRealtimeEmit(...args),
}));

const { closeAsNoAction } = await import(
  "@shared/rest/services/support/support-command/close-as-no-action"
);

beforeEach(() => {
  mockRequireConversation.mockReset();
  mockConvFindUniqueOrThrow.mockReset();
  mockRunFindFirst.mockReset();
  mockEventFindFirst.mockReset();
  mockConvUpdate.mockReset();
  mockEventCreate.mockReset();
  mockTransaction.mockReset();
  mockRealtimeEmit.mockReset();

  // The service runs everything inside `prisma.$transaction(async (tx) => ...)`.
  // The tx parameter is structurally a subset of the live client. The mock
  // executes the callback with a fake tx that exposes only the delegate
  // methods the service actually calls.
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      supportConversation: { findUniqueOrThrow: mockConvFindUniqueOrThrow, update: mockConvUpdate },
      agentTeamRun: { findFirst: mockRunFindFirst },
      supportConversationEvent: { findFirst: mockEventFindFirst, create: mockEventCreate },
    };
    return cb(tx);
  });
});

describe("closeAsNoAction", () => {
  const baseInput = {
    commandType: "CLOSE_AS_NO_ACTION" as const,
    workspaceId: "ws_1",
    conversationId: "conv_1",
    actorUserId: "user_1",
    agentTeamRunId: "atr_1",
  };

  it("happy path: transitions to DONE and writes STATUS_CHANGED audit event", async () => {
    mockRequireConversation.mockResolvedValue(undefined);
    mockConvFindUniqueOrThrow.mockResolvedValue({ status: "IN_PROGRESS" });
    mockRunFindFirst.mockResolvedValue({
      completedAt: new Date("2026-04-25T10:00:00Z"),
      status: "waiting",
    });
    // No newer customer event after run completion.
    mockEventFindFirst.mockResolvedValue(null);
    mockConvUpdate.mockResolvedValue({});
    mockEventCreate.mockResolvedValue({});
    mockRealtimeEmit.mockResolvedValue(undefined);

    const result = await closeAsNoAction(baseInput);

    expect(result.accepted).toBe(true);
    expect(mockConvUpdate).toHaveBeenCalledTimes(1);
    expect(mockConvUpdate.mock.calls[0]?.[0]?.data?.status).toBe("DONE");
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    const eventArg = mockEventCreate.mock.calls[0]?.[0]?.data;
    expect(eventArg.eventType).toBe("STATUS_CHANGED");
    expect(eventArg.eventSource).toBe("OPERATOR");
    expect(eventArg.detailsJson.reason).toBe("no_action_taken");
    expect(eventArg.detailsJson.agentTeamRunId).toBe("atr_1");
    expect(eventArg.detailsJson.actorUserId).toBe("user_1");
    expect(mockRealtimeEmit).toHaveBeenCalledTimes(1);
  });

  it("staleness guard: throws CONFLICT when a customer message arrived after run completion", async () => {
    mockRequireConversation.mockResolvedValue(undefined);
    mockConvFindUniqueOrThrow.mockResolvedValue({ status: "IN_PROGRESS" });
    mockRunFindFirst.mockResolvedValue({
      completedAt: new Date("2026-04-25T10:00:00Z"),
      status: "waiting",
    });
    // Newer customer event present.
    mockEventFindFirst.mockResolvedValue({
      id: "ev_1",
      createdAt: new Date("2026-04-25T10:05:00Z"),
    });

    await expect(closeAsNoAction(baseInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mockConvUpdate).not.toHaveBeenCalled();
    expect(mockEventCreate).not.toHaveBeenCalled();
    expect(mockRealtimeEmit).not.toHaveBeenCalled();
  });

  it("run-belongs-to-conversation guard: throws NOT_FOUND when the run id does not match", async () => {
    mockRequireConversation.mockResolvedValue(undefined);
    mockConvFindUniqueOrThrow.mockResolvedValue({ status: "IN_PROGRESS" });
    mockRunFindFirst.mockResolvedValue(null);

    await expect(closeAsNoAction(baseInput)).rejects.toBeInstanceOf(TRPCError);
    await expect(closeAsNoAction(baseInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });
});

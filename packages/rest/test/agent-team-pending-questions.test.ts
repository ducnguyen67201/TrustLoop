import { ValidationError } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirstRun = vi.fn();
const mockFindManyEvent = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    agentTeamRun: { findFirst: mockFindFirstRun },
    agentTeamRunEvent: { findMany: mockFindManyEvent },
  },
}));

const resumeRunService = await import("@shared/rest/services/agent-team/resume-run");

describe("getPendingQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out answered questions and returns dispatched ones in order", async () => {
    mockFindFirstRun.mockResolvedValue({ id: "run_1" });
    // findMany is called twice in parallel (Promise.all): once for dispatched, once for answered.
    mockFindManyEvent
      .mockResolvedValueOnce([
        {
          ts: new Date("2026-04-25T10:00:00.000Z"),
          actor: "architect",
          payload: {
            questionId: "run_1-0-0",
            target: "operator",
            question: "What's the customer's plan tier?",
            suggestedReply: null,
            assignedRole: null,
          },
        },
        {
          ts: new Date("2026-04-25T10:00:01.000Z"),
          actor: "architect",
          payload: {
            questionId: "run_1-0-1",
            target: "customer",
            question: "Could you share the error code?",
            suggestedReply: "Hey — could you share the error code from the dashboard?",
            assignedRole: null,
          },
        },
        {
          ts: new Date("2026-04-25T10:00:02.000Z"),
          actor: "architect",
          payload: {
            questionId: "run_1-0-2",
            target: "internal",
            question: "Has rca_analyst seen this stack trace before?",
            suggestedReply: null,
            assignedRole: "rca_analyst",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          payload: { questionId: "run_1-0-0" },
        },
      ]);

    const result = await resumeRunService.getPendingQuestions({
      workspaceId: "ws_1",
      runId: "run_1",
    });

    expect(result).toHaveLength(2);
    expect(result.map((q) => q.questionId)).toEqual(["run_1-0-1", "run_1-0-2"]);
    expect(result[0]).toMatchObject({
      target: "customer",
      askedByRoleKey: "architect",
      suggestedReply: "Hey — could you share the error code from the dashboard?",
    });
    expect(result[1]).toMatchObject({
      target: "internal",
      assignedRole: "rca_analyst",
    });
  });

  it("returns an empty array when nothing has been dispatched", async () => {
    mockFindFirstRun.mockResolvedValue({ id: "run_1" });
    mockFindManyEvent.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await resumeRunService.getPendingQuestions({
      workspaceId: "ws_1",
      runId: "run_1",
    });

    expect(result).toEqual([]);
  });

  it("rejects with ValidationError when the run is not in the workspace", async () => {
    mockFindFirstRun.mockResolvedValue(null);

    await expect(
      resumeRunService.getPendingQuestions({ workspaceId: "ws_1", runId: "missing" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("skips events with malformed payloads instead of throwing", async () => {
    mockFindFirstRun.mockResolvedValue({ id: "run_1" });
    mockFindManyEvent
      .mockResolvedValueOnce([
        {
          ts: new Date("2026-04-25T10:00:00.000Z"),
          actor: "architect",
          payload: { questionId: 123, target: "operator", question: "bad" },
        },
        {
          ts: new Date("2026-04-25T10:00:01.000Z"),
          actor: "architect",
          payload: {
            questionId: "run_1-0-1",
            target: "operator",
            question: "valid one",
            suggestedReply: null,
            assignedRole: null,
          },
        },
        {
          ts: new Date("2026-04-25T10:00:02.000Z"),
          actor: "architect",
          payload: {
            questionId: "run_1-0-2",
            target: "broadcast",
            question: "bad target",
          },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await resumeRunService.getPendingQuestions({
      workspaceId: "ws_1",
      runId: "run_1",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.questionId).toBe("run_1-0-1");
  });
});

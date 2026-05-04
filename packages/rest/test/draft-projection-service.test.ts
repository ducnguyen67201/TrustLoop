import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    agentTeamRun: {
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
    },
  },
}));

const draftProjection = await import("@shared/rest/services/agent-team/draft-projection-service");

const baseRun = {
  id: "run_1",
  conversationId: "conv_1",
  errorMessage: null,
  createdAt: new Date("2026-05-03T20:00:00Z"),
  messages: [
    {
      fromRoleSlug: "drafter",
      kind: "proposal",
      subject: "Draft reply",
      content: "Try restarting the worker — the queue blocked at 09:14 UTC.",
      refs: ["https://github.com/trustloop/repo/blob/main/queue.ts#L42"],
      createdAt: new Date("2026-05-03T20:01:00Z"),
    },
  ],
  facts: [
    { statement: "Worker queue blocked under sustained 429s" },
    { statement: "Subsystem: ingest-worker" },
  ],
};

describe("DraftProjection.projectFromRun", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindFirst.mockReset();
  });

  it("returns null when the run is not found", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await draftProjection.projectFromRun("missing")).toBeNull();
  });

  it("returns null when the run has no conversation linkage", async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRun, conversationId: null });
    expect(await draftProjection.projectFromRun("run_1")).toBeNull();
  });

  it("maps drafter proposal + facts onto the analysis-shaped projection", async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRun, status: "completed" });
    const projection = await draftProjection.projectFromRun("run_1");

    expect(projection).not.toBeNull();
    expect(projection?.status).toBe("READY");
    expect(projection?.draftBody).toBe(
      "Try restarting the worker — the queue blocked at 09:14 UTC."
    );
    expect(projection?.insights).toEqual([
      { text: "Worker queue blocked under sustained 429s" },
      { text: "Subsystem: ingest-worker" },
    ]);
    expect(projection?.references).toEqual([
      { url: "https://github.com/trustloop/repo/blob/main/queue.ts#L42" },
    ]);
  });

  it("returns null draftBody when the drafter produced no proposal", async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRun,
      status: "completed",
      messages: [],
    });
    const projection = await draftProjection.projectFromRun("run_1");
    expect(projection?.draftBody).toBeNull();
  });

  it.each([
    ["queued", "GATHERING_CONTEXT"],
    ["running", "ANALYZING"],
    ["completed", "READY"],
    ["waiting", "READY"],
    ["failed", "FAILED"],
  ])("maps run status %s to projection status %s", async (runStatus, projectionStatus) => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRun, status: runStatus });
    const projection = await draftProjection.projectFromRun("run_1");
    expect(projection?.status).toBe(projectionStatus);
  });
});

describe("DraftProjection.getLatestProjectionForConversation", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockFindFirst.mockReset();
  });

  it("rejects empty workspaceId / conversationId", async () => {
    await expect(
      draftProjection.getLatestProjectionForConversation("", "conv_1")
    ).rejects.toThrow();
    await expect(draftProjection.getLatestProjectionForConversation("ws_1", "")).rejects.toThrow();
  });

  it("returns null when no run exists for the conversation", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await draftProjection.getLatestProjectionForConversation("ws_1", "conv_1");
    expect(result).toBeNull();
  });

  it("returns the latest run shaped as a projection", async () => {
    mockFindFirst.mockResolvedValueOnce({ ...baseRun, status: "completed" });
    const result = await draftProjection.getLatestProjectionForConversation("ws_1", "conv_1");
    expect(result?.status).toBe("READY");
    expect(result?.draftBody).toContain("queue blocked");
  });
});

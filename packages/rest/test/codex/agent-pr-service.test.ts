import * as agentPrs from "@shared/rest/services/codex/agent-pr-service";
import { describe, expect, it, vi } from "vitest";

// Avoid env validation by short-circuiting the Prisma client import.
// Each test installs the model methods it cares about via vi.mocked.
const findMany = vi.fn();
vi.mock("@shared/database", () => ({
  prisma: {
    agentPullRequest: {
      get findMany() {
        return findMany;
      },
    },
  },
}));

const ROW = {
  id: "apr_1",
  prNumber: 42,
  prUrl: "https://github.com/acme/repo/pull/42",
  branchName: "trustloop/fix-1",
  baseBranch: "main",
  title: "Fix the thing",
  status: "open" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  repository: { fullName: "acme/repo" },
};

describe("listForConversation", () => {
  it("scopes to workspaceId AND conversationId", async () => {
    findMany.mockResolvedValueOnce([]);
    await agentPrs.listForConversation("ws_1", "conv_1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws_1", conversationId: "conv_1" },
      })
    );
  });

  it("orders by createdAt desc and caps at 25 rows", async () => {
    findMany.mockResolvedValueOnce([]);
    await agentPrs.listForConversation("ws_1", "conv_1");
    const args = findMany.mock.calls.at(-1)?.[0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(25);
  });

  it("maps rows to AgentPrSummary with ISO createdAt", async () => {
    findMany.mockResolvedValueOnce([ROW]);
    const out = await agentPrs.listForConversation("ws_1", "conv_1");
    expect(out).toEqual([
      {
        id: "apr_1",
        prNumber: 42,
        prUrl: "https://github.com/acme/repo/pull/42",
        branchName: "trustloop/fix-1",
        baseBranch: "main",
        title: "Fix the thing",
        status: "open",
        repositoryFullName: "acme/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("listForAnalysis", () => {
  it("scopes to workspaceId AND analysisId", async () => {
    findMany.mockResolvedValueOnce([]);
    await agentPrs.listForAnalysis("ws_1", "an_1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws_1", analysisId: "an_1" },
      })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the underlying call sites so we can assert how the closure passes
// workspaceId/conversationId/analysisId down. Each test exercises the
// security-critical invariant: the LLM cannot override the closure-bound
// workspaceId by smuggling one into its tool input.

// Short-circuit env validation; the agents service validates env on
// import via @shared/env which transitively gets pulled in by these
// tools. We never read env in this file's assertions.
vi.mock("@shared/env", () => ({
  env: {
    OPENAI_API_KEY: "openai-test-key",
    OPENROUTER_API_KEY: "",
    APP_BASE_URL: "http://localhost:3000",
    INTERNAL_SERVICE_KEY: "tli_test_internal_service_key_value",
  },
}));

// Avoid env validation triggered by @shared/database transitively.
vi.mock("@shared/database", () => ({
  prisma: {},
}));

const createDraftPullRequest = vi.fn();
const readIndexedRepositoryFile = vi.fn();
const searchWorkspaceCode = vi.fn();

vi.mock("@shared/rest/codex/github/draft-pr", async () => {
  const actual = await vi.importActual<typeof import("@shared/rest/codex/github/draft-pr")>(
    "@shared/rest/codex/github/draft-pr"
  );
  return {
    ...actual,
    createDraftPullRequest: (input: unknown) => createDraftPullRequest(input),
  };
});

vi.mock("@shared/rest/codex/workspace-code-search", () => ({
  searchWorkspaceCode: (...args: unknown[]) => searchWorkspaceCode(...args),
}));

vi.mock("@shared/rest/codex/github/content", () => ({
  readIndexedRepositoryFile: (...args: unknown[]) => readIndexedRepositoryFile(...args),
}));

const { buildCreatePullRequestTool } = await import("../src/tools/create-pr");
const { buildReadRepositoryFileTool } = await import("../src/tools/read-repository-file");
const { buildSearchCodeTool } = await import("../src/tools/search-code");
const { buildSearchSentryTool } = await import("../src/tools/search-sentry");

beforeEach(() => {
  createDraftPullRequest.mockReset();
  readIndexedRepositoryFile.mockReset();
  searchWorkspaceCode.mockReset();
});

// Mastra Tool exposes execute via getter; calling .execute(input) is the
// LLM-equivalent invocation path. The tool's input type intentionally
// excludes workspaceId and friends (closure-bound), so hostile inputs
// that smuggle those fields are typed as `never` to satisfy biome.
function callExecute<I, O>(
  tool: { execute: (i: I) => Promise<O> },
  input: Record<string, unknown>
): Promise<O> {
  return tool.execute(input as never as I);
}

describe("buildCreatePullRequestTool — closure binds workspaceId server-side", () => {
  it("passes ctx.workspaceId/conversationId/analysisId into createDraftPullRequest", async () => {
    createDraftPullRequest.mockResolvedValueOnce({
      success: true,
      prUrl: "https://x",
      prNumber: 1,
      branchName: "b",
    });
    const tool = buildCreatePullRequestTool({
      workspaceId: "ws_a",
      conversationId: "conv_a",
      analysisId: "an_a",
    });
    await callExecute(tool, {
      repositoryFullName: "acme/repo",
      title: "fix",
      description: "d",
      changes: [{ filePath: "x.ts", content: "y" }],
    });
    expect(createDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_a",
        conversationId: "conv_a",
        analysisId: "an_a",
      })
    );
  });

  it("hostile workspaceId in LLM input cannot override the closure", async () => {
    createDraftPullRequest.mockResolvedValueOnce({
      success: true,
      prUrl: "https://x",
      prNumber: 1,
      branchName: "b",
    });
    const tool = buildCreatePullRequestTool({ workspaceId: "ws_a" });
    await callExecute(tool, {
      // Hostile field — not declared in inputSchema, but the LLM could still
      // emit it. The closure must win.
      workspaceId: "ws_evil",
      repositoryFullName: "acme/repo",
      title: "fix",
      description: "d",
      changes: [{ filePath: "x.ts", content: "y" }],
    });
    expect(createDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_a" })
    );
  });
});

describe("buildSearchCodeTool — closure binds workspaceId server-side", () => {
  it("passes ctx.workspaceId as the first arg to searchWorkspaceCode", async () => {
    searchWorkspaceCode.mockResolvedValueOnce([]);
    const tool = buildSearchCodeTool({ workspaceId: "ws_a" });
    await callExecute(tool, { query: "auth" });
    expect(searchWorkspaceCode).toHaveBeenCalledWith("ws_a", "auth", expect.any(Object));
  });

  it("hostile workspaceId in input cannot override the closure", async () => {
    searchWorkspaceCode.mockResolvedValueOnce([]);
    const tool = buildSearchCodeTool({ workspaceId: "ws_a" });
    await callExecute(tool, { query: "auth", workspaceId: "ws_evil" });
    const lastCall = searchWorkspaceCode.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("ws_a");
  });
});

describe("buildReadRepositoryFileTool — closure binds workspaceId server-side", () => {
  it("passes ctx.workspaceId into readIndexedRepositoryFile", async () => {
    readIndexedRepositoryFile.mockResolvedValueOnce({
      success: true,
      repositoryFullName: "acme/repo",
      filePath: "x.ts",
      baseBranch: "main",
      content: "content",
    });
    const tool = buildReadRepositoryFileTool({ workspaceId: "ws_a" });
    await callExecute(tool, {
      repositoryFullName: "acme/repo",
      filePath: "x.ts",
      workspaceId: "ws_evil",
    });
    expect(readIndexedRepositoryFile).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_a",
        repositoryFullName: "acme/repo",
        filePath: "x.ts",
      })
    );
  });
});

describe("buildSearchSentryTool — closure binds workspaceId in stub output", () => {
  it("only the closure-bound workspaceId appears in the response", async () => {
    const tool = buildSearchSentryTool({ workspaceId: "ws_a" });
    const out = await callExecute(tool, { query: "crash", workspaceId: "ws_evil" });
    const serialized = JSON.stringify(out);
    expect(serialized).toContain("ws_a");
    expect(serialized).not.toContain("ws_evil");
  });
});

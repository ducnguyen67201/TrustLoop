import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@shared/database", () => ({
  prisma: {
    repositoryIndexVersion: {
      findMany: vi.fn(),
    },
    repositoryIndexChunk: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@shared/database";
import { searchWorkspaceCode } from "@shared/rest/codex/workspace-code-search";

const mockVersions = [
  {
    id: "v1",
    status: "active",
    repository: { id: "repo_1", fullName: "org/api-server" },
  },
  {
    id: "v2",
    status: "active",
    repository: { id: "repo_2", fullName: "org/frontend" },
  },
];

const mockChunks = [
  {
    id: "chunk_1",
    indexVersionId: "v1",
    filePath: "src/auth/auth-service.ts",
    lineStart: 10,
    lineEnd: 40,
    content: "export function verifyToken(token: string) { /* verify auth token */ }",
    symbolName: "verifyToken",
  },
  {
    id: "chunk_2",
    indexVersionId: "v1",
    filePath: "src/auth/session.ts",
    lineStart: 1,
    lineEnd: 30,
    content: "export function createSession(userId: string) { /* create user session */ }",
    symbolName: "createSession",
  },
  {
    id: "chunk_3",
    indexVersionId: "v2",
    filePath: "src/components/Login.tsx",
    lineStart: 1,
    lineEnd: 50,
    content: "export function Login() { return <form>login form</form> }",
    symbolName: "Login",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchWorkspaceCode", () => {
  it("returns empty array when no active index versions exist", async () => {
    vi.mocked(prisma.repositoryIndexVersion.findMany).mockResolvedValue([]);

    const results = await searchWorkspaceCode("ws_1", "auth token");
    expect(results).toEqual([]);
  });

  it("searches across all repos and returns scored results", async () => {
    vi.mocked(prisma.repositoryIndexVersion.findMany).mockResolvedValue(mockVersions as any);
    vi.mocked(prisma.repositoryIndexChunk.count).mockResolvedValue(3);
    vi.mocked(prisma.repositoryIndexChunk.findMany).mockResolvedValue(mockChunks as any);

    const results = await searchWorkspaceCode("ws_1", "auth token verify");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toBe("src/auth/auth-service.ts");
    expect(results[0].repositoryFullName).toBe("org/api-server");
    expect(results[0].mergedScore).toBeGreaterThan(0);
  });

  it("respects the limit parameter", async () => {
    vi.mocked(prisma.repositoryIndexVersion.findMany).mockResolvedValue(mockVersions as any);
    vi.mocked(prisma.repositoryIndexChunk.count).mockResolvedValue(3);
    vi.mocked(prisma.repositoryIndexChunk.findMany).mockResolvedValue(mockChunks as any);

    const results = await searchWorkspaceCode("ws_1", "auth", { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("falls back to Prisma query when chunk count exceeds guard", async () => {
    vi.mocked(prisma.repositoryIndexVersion.findMany).mockResolvedValue(mockVersions as any);
    vi.mocked(prisma.repositoryIndexChunk.count).mockResolvedValue(6000);
    vi.mocked(prisma.repositoryIndexChunk.findMany).mockResolvedValue([mockChunks[0]] as any);

    const results = await searchWorkspaceCode("ws_1", "auth");

    // Should have called findMany twice: once for versions, once for the SQL fallback
    expect(prisma.repositoryIndexChunk.findMany).toHaveBeenCalledTimes(1);
    expect(results.length).toBe(1);
    expect(results[0].mergedScore).toBe(0); // SQL fallback doesn't score
  });

  it("applies filePattern filter", async () => {
    vi.mocked(prisma.repositoryIndexVersion.findMany).mockResolvedValue(mockVersions as any);
    vi.mocked(prisma.repositoryIndexChunk.count).mockResolvedValue(3);
    vi.mocked(prisma.repositoryIndexChunk.findMany).mockResolvedValue([mockChunks[0]] as any);

    await searchWorkspaceCode("ws_1", "auth", { filePattern: "auth" });

    const findManyCall = vi.mocked(prisma.repositoryIndexChunk.findMany).mock.calls[0][0] as any;
    expect(findManyCall.where.filePath).toEqual({ contains: "auth" });
  });

  it("returns results from multiple repositories", async () => {
    vi.mocked(prisma.repositoryIndexVersion.findMany).mockResolvedValue(mockVersions as any);
    vi.mocked(prisma.repositoryIndexChunk.count).mockResolvedValue(3);
    vi.mocked(prisma.repositoryIndexChunk.findMany).mockResolvedValue(mockChunks as any);

    const results = await searchWorkspaceCode("ws_1", "function export");

    const repos = new Set(results.map((r) => r.repositoryFullName));
    expect(repos.size).toBeGreaterThanOrEqual(1);
  });
});

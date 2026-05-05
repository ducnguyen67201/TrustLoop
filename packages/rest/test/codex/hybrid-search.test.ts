import { describe, expect, it, vi } from "vitest";

const mockGenerateEmbeddings = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);

// Mock env and database before importing hybrid-search
vi.mock("@shared/env", () => ({
  env: { OPENAI_API_KEY: "test-key" },
}));
vi.mock("@shared/database", () => ({
  prisma: { $queryRawUnsafe: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@shared/rest/services/codex/embedding", () => ({
  splitIdentifiers: (query: string) => query,
  generate: mockGenerateEmbeddings,
  formatVector: (embedding: number[]) => `[${embedding.join(",")}]`,
}));
vi.mock("@shared/rest/services/llm-manager-service", () => ({
  resolveRoute: () => null,
}));
vi.mock("openai", () => ({
  default: vi.fn(),
}));

const {
  buildKeywordTsQuery,
  extractLiteralSearchTerms,
  hybridSearch,
  literalSearch,
  reciprocalRankFusion,
} = await import("../../src/codex/hybrid-search");
type ScoredChunk = import("../../src/codex/hybrid-search").ScoredChunk;

function makeChunk(id: string, score: number, overrides: Partial<ScoredChunk> = {}): ScoredChunk {
  return {
    id,
    filePath: `src/${id}.ts`,
    symbolName: id,
    lineStart: 1,
    lineEnd: 10,
    content: `function ${id}() {}`,
    contentHash: `hash-${id}`,
    language: "ts",
    score,
    ...overrides,
  };
}

describe("reciprocalRankFusion", () => {
  it("ranks chunks appearing in both lists higher", () => {
    const vectorResults = [makeChunk("a", 0.9), makeChunk("b", 0.8), makeChunk("c", 0.7)];
    const keywordResults = [makeChunk("b", 5), makeChunk("d", 3), makeChunk("a", 2)];

    const fused = reciprocalRankFusion("test query", vectorResults, keywordResults);

    const ids = fused.map((c) => c.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
  });

  it("assigns both vectorRank and keywordRank for dual-list chunks", () => {
    const vectorResults = [makeChunk("a", 0.9)];
    const keywordResults = [makeChunk("a", 5)];

    const fused = reciprocalRankFusion("test", vectorResults, keywordResults);
    expect(fused[0]!.vectorRank).toBe(1);
    expect(fused[0]!.keywordRank).toBe(1);
  });

  it("assigns null for missing rank in single-list chunks", () => {
    const vectorResults = [makeChunk("a", 0.9)];
    const keywordResults = [makeChunk("b", 5)];

    const fused = reciprocalRankFusion("test", vectorResults, keywordResults);
    const chunkA = fused.find((c) => c.id === "a")!;
    const chunkB = fused.find((c) => c.id === "b")!;

    expect(chunkA.vectorRank).toBe(1);
    expect(chunkA.keywordRank).toBeNull();
    expect(chunkB.vectorRank).toBeNull();
    expect(chunkB.keywordRank).toBe(1);
  });

  it("handles empty lists", () => {
    const fused = reciprocalRankFusion("test", [], []);
    expect(fused).toHaveLength(0);
  });

  it("applies path score bonus when query matches file path", () => {
    const vectorResults = [
      makeChunk("auth", 0.9, { filePath: "src/auth/login.ts" }),
      makeChunk("utils", 0.8, { filePath: "src/utils/format.ts" }),
    ];

    const fused = reciprocalRankFusion("auth login", vectorResults, []);
    const authChunk = fused.find((c) => c.id === "auth")!;
    const utilsChunk = fused.find((c) => c.id === "utils")!;

    expect(authChunk.rrfScore).toBeGreaterThan(utilsChunk.rrfScore);
  });

  it("deduplicates chunks by id across lists", () => {
    const vectorResults = [makeChunk("a", 0.9), makeChunk("a", 0.8)];
    const keywordResults = [makeChunk("a", 5)];

    const fused = reciprocalRankFusion("test", vectorResults, keywordResults);
    const countA = fused.filter((c) => c.id === "a").length;
    expect(countA).toBe(1);
  });

  it("sorts by rrfScore descending", () => {
    const vectorResults = [makeChunk("a", 0.5), makeChunk("b", 0.9)];
    const keywordResults = [makeChunk("c", 5), makeChunk("b", 3)];

    const fused = reciprocalRankFusion("test", vectorResults, keywordResults);
    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1]!.rrfScore).toBeGreaterThanOrEqual(fused[i]!.rrfScore);
    }
  });
});

describe("extractLiteralSearchTerms", () => {
  it("keeps route-like literals intact", () => {
    expect(extractLiteralSearchTerms("Check `/api/does-not-exist` endpoint")).toContain(
      "/api/does-not-exist"
    );
  });

  it("ignores plain prose tokens", () => {
    expect(extractLiteralSearchTerms("customer reported a problem")).toEqual([]);
  });
});

describe("buildKeywordTsQuery", () => {
  it("drops punctuation that would make to_tsquery invalid", () => {
    expect(
      buildKeywordTsQuery('Tool input: {"query":"Check `/api/does-not-exist` endpoint"}')
    ).toBe("tool & input & query & check & api/does-not-exist & endpoint");
  });
});

describe("literalSearch", () => {
  it("uses an escaped substring fallback for URL and path-like queries", async () => {
    const { prisma } = await import("@shared/database");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      makeChunk("error-panel", 1, {
        filePath: "apps/demo-app/src/components/error-panel.tsx",
        content: 'fetch("/api/does-not-exist")',
      }),
    ]);

    const results = await literalSearch("version_1", "/api/does-not-exist");

    expect(results[0]?.filePath).toBe("apps/demo-app/src/components/error-panel.tsx");
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("ILIKE"),
      "version_1",
      expect.any(Number),
      expect.any(Number),
      "%/api/does-not-exist%"
    );
  });
});

describe("hybridSearch", () => {
  it("falls back to keyword and literal search when embeddings are unavailable", async () => {
    const { prisma } = await import("@shared/database");
    mockGenerateEmbeddings.mockRejectedValueOnce(new Error("embedding route unavailable"));
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeChunk("error-panel", 1, {
          filePath: "apps/demo-app/src/components/error-panel.tsx",
          content: 'fetch("/api/does-not-exist")',
        }),
      ]);

    const results = await hybridSearch("/api/does-not-exist", "version_1");

    expect(results[0]?.filePath).toBe("apps/demo-app/src/components/error-panel.tsx");
  });
});

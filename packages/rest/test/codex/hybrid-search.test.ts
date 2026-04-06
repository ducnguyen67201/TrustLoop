import { describe, expect, it, vi } from "vitest";

// Mock env and database before importing hybrid-search
vi.mock("@shared/env", () => ({
  env: { OPENAI_API_KEY: "test-key" },
}));
vi.mock("@shared/database", () => ({
  prisma: { $queryRawUnsafe: vi.fn().mockResolvedValue([]) },
}));
vi.mock("openai", () => ({
  default: vi.fn(),
}));

const { reciprocalRankFusion } = await import("../../src/codex/hybrid-search");
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

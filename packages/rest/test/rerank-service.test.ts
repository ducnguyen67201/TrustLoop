import { KNOWLEDGE_CHUNK_SOURCE, type KnowledgeHit } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the LLM manager surface used by rerank-service. resolveRoute returns a
// fake route (so rerank attempts to run). executeWithFallback delegates to the
// inner async function with a minimal fake target — the test controls what
// the chat completion call returns by mocking the OpenAI client factory.

const mockResolveRoute = vi.fn();
const mockExecuteWithFallback = vi.fn();
const mockChatCreate = vi.fn();
const mockCreateClient = vi.fn(() => ({
  chat: { completions: { create: mockChatCreate } },
}));

vi.mock("@shared/rest/services/llm-manager-service", () => ({
  resolveRoute: mockResolveRoute,
  executeWithFallback: mockExecuteWithFallback,
  createOpenAiCompatibleClient: mockCreateClient,
}));

const { rerank } = await import("../src/services/rerank-service");

const fakeRoute = {
  useCase: "knowledge-rerank",
  targets: [{ provider: "openai", model: "gpt-4o-mini", apiModel: "gpt-4o-mini" }],
};

function makeHit(id: string, content: string, score: number): KnowledgeHit {
  return {
    id,
    source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
    content,
    score,
    metadata: {
      source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
      conversationId: `conv-${id}`,
      sourceEventId: `evt-${id}`,
      approvedAt: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  mockResolveRoute.mockReset();
  mockExecuteWithFallback.mockReset();
  mockChatCreate.mockReset();
  mockCreateClient.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rerank — fallback paths", () => {
  it("returns empty hits, no LLM call, when input is empty", async () => {
    const result = await rerank({ query: "anything", hits: [] });

    expect(result.hits).toEqual([]);
    expect(result.rerankerUsed).toBe(false);
    expect(mockResolveRoute).not.toHaveBeenCalled();
  });

  it("falls back to per-source quota when no LLM route is configured", async () => {
    mockResolveRoute.mockReturnValue(null);

    const hits = [
      makeHit("a", "alpha", 0.9),
      makeHit("b", "beta", 0.7),
      makeHit("c", "gamma", 0.5),
    ];
    const result = await rerank({ query: "x", hits, topK: 2 });

    expect(result.rerankerUsed).toBe(false);
    expect(result.hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(mockExecuteWithFallback).not.toHaveBeenCalled();
  });

  it("falls back when the LLM call throws (network error / timeout)", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockRejectedValue(new Error("network down"));

    const hits = [makeHit("a", "alpha", 0.9), makeHit("b", "beta", 0.7)];
    const result = await rerank({ query: "x", hits });

    expect(result.rerankerUsed).toBe(false);
    expect(result.hits).toHaveLength(2);
  });

  it("falls back when the LLM returns null content", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({ result: null });

    const hits = [makeHit("a", "alpha", 0.9)];
    const result = await rerank({ query: "x", hits });

    expect(result.rerankerUsed).toBe(false);
    expect(result.hits).toEqual([hits[0]]);
  });

  it("falls back when the LLM returns malformed JSON", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({ result: "not json at all" });

    const hits = [makeHit("a", "alpha", 0.9), makeHit("b", "beta", 0.7)];
    const result = await rerank({ query: "x", hits });

    expect(result.rerankerUsed).toBe(false);
    expect(result.hits).toHaveLength(2);
  });

  it("falls back when the LLM returns valid JSON but with no scores", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({
      result: JSON.stringify({ results: [] }),
    });

    const hits = [makeHit("a", "alpha", 0.9), makeHit("b", "beta", 0.7)];
    const result = await rerank({ query: "x", hits });

    expect(result.rerankerUsed).toBe(false);
    expect(result.hits).toHaveLength(2);
  });
});

describe("rerank — happy path", () => {
  it("reorders hits according to LLM relevance scores (descending)", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({
      result: JSON.stringify([
        { index: 2, score: 9.5, reason: "best match" },
        { index: 0, score: 6.0, reason: "related" },
        { index: 1, score: 3.0, reason: "tangential" },
      ]),
    });

    const hits = [
      makeHit("a", "alpha", 0.9),
      makeHit("b", "beta", 0.7),
      makeHit("c", "gamma", 0.5),
    ];
    const result = await rerank({ query: "x", hits });

    expect(result.rerankerUsed).toBe(true);
    expect(result.hits.map((h) => h.id)).toEqual(["c", "a", "b"]);
    expect(result.hits.map((h) => h.score)).toEqual([9.5, 6.0, 3.0]);
  });

  it("respects topK after reranking", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({
      result: JSON.stringify({
        rankings: [
          { index: 1, score: 9, reason: "best" },
          { index: 0, score: 4, reason: "ok" },
        ],
      }),
    });

    const hits = [makeHit("a", "alpha", 0.9), makeHit("b", "beta", 0.7)];
    const result = await rerank({ query: "x", hits, topK: 1 });

    expect(result.rerankerUsed).toBe(true);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.id).toBe("b");
  });

  it("preserves source-specific metadata across reorder", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({
      result: JSON.stringify([{ index: 0, score: 9, reason: "match" }]),
    });

    const hits = [makeHit("a", "alpha", 0.9)];
    const result = await rerank({ query: "x", hits });

    expect(result.hits[0]!.metadata).toMatchObject({
      source: "PAST_RESOLUTION",
      conversationId: "conv-a",
      sourceEventId: "evt-a",
    });
  });

  it("ignores out-of-range indices in the LLM response", async () => {
    mockResolveRoute.mockReturnValue(fakeRoute);
    mockExecuteWithFallback.mockResolvedValue({
      result: JSON.stringify([
        { index: 99, score: 9, reason: "phantom" },
        { index: 0, score: 7, reason: "real" },
      ]),
    });

    const hits = [makeHit("a", "alpha", 0.9), makeHit("b", "beta", 0.7)];
    const result = await rerank({ query: "x", hits });

    expect(result.rerankerUsed).toBe(true);
    expect(result.hits.map((h) => h.id)).toEqual(["a"]);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@shared/database", () => ({
  prisma: {},
}));
vi.mock("@shared/env", () => ({
  env: {},
}));
vi.mock("@shared/rest/services/codex/embedding", () => ({
  generateEmbeddings: vi.fn(),
  getCachedEmbeddings: vi.fn(),
  splitIdentifiers: vi.fn((t: string) => t),
  formatVector: vi.fn(),
  EMBEDDING_MODEL: "test",
}));
vi.mock("@temporalio/activity", () => ({
  ApplicationFailure: { nonRetryable: vi.fn() },
}));

const { computeQualityScore } = await import("../../src/domains/codex/repository-index.activity");

function makeChunk(overrides: {
  content?: string;
  filePath?: string;
  symbolName?: string | null;
}) {
  return {
    filePath: overrides.filePath ?? "src/example.ts",
    language: "ts",
    symbolName: overrides.symbolName ?? null,
    lineStart: 1,
    lineEnd: 20,
    contentHash: "abc123",
    content: overrides.content ?? 'export function hello() {\n  return "world";\n}',
  };
}

describe("computeQualityScore", () => {
  it("returns base score for average chunk", () => {
    const score = computeQualityScore(makeChunk({}));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("penalizes import-only chunks", () => {
    const importChunk = makeChunk({
      content: [
        'import { foo } from "./foo";',
        'import { bar } from "./bar";',
        'import { baz } from "./baz";',
        'import { qux } from "./qux";',
        'import { quux } from "./quux";',
      ].join("\n"),
    });
    const normalChunk = makeChunk({
      content: 'export function hello() {\n  return "world";\n}',
    });
    expect(computeQualityScore(importChunk)).toBeLessThan(computeQualityScore(normalChunk));
  });

  it("penalizes barrel files", () => {
    const barrel = makeChunk({
      filePath: "src/index.ts",
      content: [
        'export { foo } from "./foo";',
        'export { bar } from "./bar";',
        'export { baz } from "./baz";',
      ].join("\n"),
    });
    expect(computeQualityScore(barrel)).toBeLessThan(0.5);
  });

  it("penalizes test files", () => {
    const testFile = makeChunk({
      filePath: "src/auth.test.ts",
      content: 'describe("auth", () => {\n  it("works", () => {});\n});',
    });
    const srcFile = makeChunk({
      filePath: "src/auth.ts",
      content: "export function authenticate() {\n  return true;\n}",
    });
    expect(computeQualityScore(testFile)).toBeLessThan(computeQualityScore(srcFile));
  });

  it("penalizes very short chunks", () => {
    const short = makeChunk({ content: "x" });
    expect(computeQualityScore(short)).toBeLessThan(0.5);
  });

  it("rewards chunks with symbol names", () => {
    const withSymbol = computeQualityScore(makeChunk({ symbolName: "processOrder" }));
    const without = computeQualityScore(makeChunk({ symbolName: null }));
    expect(withSymbol).toBeGreaterThan(without);
  });

  it("rewards medium-length chunks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `  const x${i} = ${i};`);
    const medium = makeChunk({ content: lines.join("\n") });
    expect(computeQualityScore(medium)).toBeGreaterThanOrEqual(0.5);
  });

  it("rewards chunks with comments", () => {
    const withComments = makeChunk({
      content: "// Processes the order\nexport function processOrder() {\n  return true;\n}",
    });
    const without = makeChunk({
      content: "export function processOrder() {\n  return true;\n}",
    });
    expect(computeQualityScore(withComments)).toBeGreaterThanOrEqual(computeQualityScore(without));
  });

  it("clamps score to [0, 1]", () => {
    const worst = makeChunk({
      filePath: "src/index.test.ts",
      content: "x",
    });
    expect(computeQualityScore(worst)).toBeGreaterThanOrEqual(0);
    expect(computeQualityScore(worst)).toBeLessThanOrEqual(1);
  });
});

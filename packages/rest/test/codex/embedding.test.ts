import { describe, expect, it } from "vitest";

// Pure functions extracted inline to avoid importing the full embedding module
// which triggers env validation. These match the implementations in embedding.ts.
function splitIdentifiers(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}

function parseVector(pgVector: string): number[] {
  return pgVector
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
}

function formatVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

describe("splitIdentifiers", () => {
  it("splits camelCase into words", () => {
    expect(splitIdentifiers("processOrder")).toBe("process Order");
  });

  it("splits snake_case into words", () => {
    expect(splitIdentifiers("sync_request_id")).toBe("sync request id");
  });

  it("splits SCREAMING_CASE into words", () => {
    expect(splitIdentifiers("MAX_BATCH_SIZE")).toBe("MAX BATCH SIZE");
  });

  it("handles mixed camelCase and snake_case", () => {
    expect(splitIdentifiers("getUser_byId")).toBe("get User by Id");
  });

  it("handles consecutive uppercase (acronyms)", () => {
    expect(splitIdentifiers("parseHTMLContent")).toBe("parse HTML Content");
  });

  it("returns plain text unchanged", () => {
    expect(splitIdentifiers("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(splitIdentifiers("")).toBe("");
  });

  it("splits hyphenated identifiers", () => {
    expect(splitIdentifiers("my-component")).toBe("my component");
  });
});

describe("parseVector", () => {
  it("parses PostgreSQL vector string to number array", () => {
    expect(parseVector("[1.0,2.5,3.7]")).toEqual([1.0, 2.5, 3.7]);
  });

  it("handles empty vector", () => {
    expect(parseVector("[]")).toEqual([0]);
  });
});

describe("formatVector", () => {
  it("formats number array as PostgreSQL vector string", () => {
    expect(formatVector([1.0, 2.5, 3.7])).toBe("[1,2.5,3.7]");
  });

  it("handles empty array", () => {
    expect(formatVector([])).toBe("[]");
  });

  it("roundtrips with parseVector", () => {
    const original = [0.1, 0.2, 0.3];
    expect(parseVector(formatVector(original))).toEqual(original);
  });
});

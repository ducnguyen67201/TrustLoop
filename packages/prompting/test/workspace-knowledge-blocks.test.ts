import { KNOWLEDGE_CHUNK_SOURCE, type KnowledgeHit } from "@shared/types";
import { describe, expect, it } from "vitest";
import { buildKnowledgeSections } from "../src/blocks/workspace-knowledge";

function codeHit(id: string): KnowledgeHit {
  return {
    id: `code-${id}`,
    source: KNOWLEDGE_CHUNK_SOURCE.CODE,
    content: `function ${id}() {}`,
    score: 0.9,
    metadata: {
      source: KNOWLEDGE_CHUNK_SOURCE.CODE,
      filePath: `src/${id}.ts`,
      lineStart: 1,
      lineEnd: 5,
      repositoryId: "repo-1",
      language: "ts",
    },
  };
}

function noteHit(id: string): KnowledgeHit {
  return {
    id: `note-${id}`,
    source: KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
    content: `Refund policy ${id} body text…`,
    score: 0.8,
    metadata: {
      source: KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
      noteId: `note-${id}`,
      title: `Refund policy ${id}`,
    },
  };
}

function pastHit(id: string): KnowledgeHit {
  return {
    id: `past-${id}`,
    source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
    content: `Q: question ${id}\n\nA: answer ${id}`,
    score: 0.7,
    metadata: {
      source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
      conversationId: `conv-${id}`,
      sourceEventId: `evt-${id}`,
      approvedAt: new Date("2026-05-01").toISOString(),
    },
  };
}

describe("buildKnowledgeSections", () => {
  it("produces zero sections when all sources are empty", () => {
    expect(buildKnowledgeSections({})).toEqual([]);
    expect(buildKnowledgeSections({ code: [], notes: [], pastResolutions: [] })).toEqual([]);
  });

  it("emits a Related code section when code hits exist", () => {
    const sections = buildKnowledgeSections({ code: [codeHit("a"), codeHit("b")] });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe("Related code");
    expect(sections[0]!.type).toBe("structured");
    if (sections[0]!.type !== "structured") throw new Error("expected structured section");
    expect(sections[0]!.preferredFormat).toBe("toon");
    expect(Array.isArray(sections[0]!.payload)).toBe(true);
  });

  it("emits a Knowledge notes section with title + content", () => {
    const sections = buildKnowledgeSections({ notes: [noteHit("a")] });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe("Knowledge notes");
    if (sections[0]!.type !== "structured") throw new Error("expected structured section");
    const payload = sections[0]!.payload as Array<{ title: string; content: string }>;
    expect(payload[0]!.title).toBe("Refund policy a");
    expect(payload[0]!.content).toContain("Refund policy");
  });

  it("emits a Similar past resolutions section with anti-stale framing rationale", () => {
    const sections = buildKnowledgeSections({ pastResolutions: [pastHit("a")] });
    expect(sections).toHaveLength(1);
    if (sections[0]!.type !== "structured") throw new Error("expected structured section");
    expect(sections[0]!.title).toBe("Similar past resolutions");
    // The rationale is what protects against stale-truth carryover; assert it
    // explicitly so the safety framing can't quietly drift away.
    expect(sections[0]!.rationale).toContain("Use for tone and structure ONLY");
    expect(sections[0]!.rationale).toContain("verify current policy");
  });

  it("emits all three sections in code/notes/pastResolutions order", () => {
    const sections = buildKnowledgeSections({
      code: [codeHit("a")],
      notes: [noteHit("a")],
      pastResolutions: [pastHit("a")],
    });
    expect(sections.map((s) => s.title)).toEqual([
      "Related code",
      "Knowledge notes",
      "Similar past resolutions",
    ]);
  });

  it("filters out wrong-source hits defensively (e.g. code hits in the notes lane)", () => {
    // Caller passes a CODE hit into the notes lane by mistake. The block helper
    // filters it out rather than crashing; produces zero sections.
    const sections = buildKnowledgeSections({ notes: [codeHit("a")] });
    expect(sections).toEqual([]);
  });

  it("preserves multiple hits in declaration order within a section", () => {
    const sections = buildKnowledgeSections({
      code: [codeHit("first"), codeHit("second"), codeHit("third")],
    });
    if (sections[0]!.type !== "structured") throw new Error("expected structured section");
    const payload = sections[0]!.payload as Array<{ filePath: string }>;
    expect(payload.map((p) => p.filePath)).toEqual([
      "src/first.ts",
      "src/second.ts",
      "src/third.ts",
    ]);
  });
});

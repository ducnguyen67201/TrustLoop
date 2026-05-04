import {
  ANALYSIS_CATEGORY,
  ANALYSIS_SEVERITY,
  ANALYSIS_STATUS,
  ANALYSIS_TRIGGER_TYPE,
  DRAFT_STATUS,
  EVIDENCE_SOURCE_TYPE,
  agentOutputSchema,
  analysisStatusSchema,
  approveDraftInputSchema,
  dismissDraftInputSchema,
  draftStatusSchema,
  getLatestAnalysisInputSchema,
} from "@shared/types";
import { describe, expect, it } from "vitest";

describe("analysis const enums", () => {
  it("ANALYSIS_STATUS has all expected values", () => {
    expect(ANALYSIS_STATUS.gatheringContext).toBe("GATHERING_CONTEXT");
    expect(ANALYSIS_STATUS.analyzing).toBe("ANALYZING");
    expect(ANALYSIS_STATUS.analyzed).toBe("ANALYZED");
    expect(ANALYSIS_STATUS.needsContext).toBe("NEEDS_CONTEXT");
    expect(ANALYSIS_STATUS.failed).toBe("FAILED");
  });

  it("ANALYSIS_SEVERITY has all expected values", () => {
    expect(ANALYSIS_SEVERITY.low).toBe("LOW");
    expect(ANALYSIS_SEVERITY.critical).toBe("CRITICAL");
  });

  it("ANALYSIS_CATEGORY has all expected values", () => {
    expect(ANALYSIS_CATEGORY.bug).toBe("BUG");
    expect(ANALYSIS_CATEGORY.unknown).toBe("UNKNOWN");
  });

  it("DRAFT_STATUS has GENERATING and all lifecycle states", () => {
    expect(DRAFT_STATUS.generating).toBe("GENERATING");
    expect(DRAFT_STATUS.awaitingApproval).toBe("AWAITING_APPROVAL");
    expect(DRAFT_STATUS.approved).toBe("APPROVED");
    expect(DRAFT_STATUS.sent).toBe("SENT");
    expect(DRAFT_STATUS.dismissed).toBe("DISMISSED");
    expect(DRAFT_STATUS.failed).toBe("FAILED");
  });

  it("EVIDENCE_SOURCE_TYPE starts with CODE_CHUNK only", () => {
    expect(Object.values(EVIDENCE_SOURCE_TYPE)).toEqual(["CODE_CHUNK"]);
  });

  it("ANALYSIS_TRIGGER_TYPE has AUTO and MANUAL", () => {
    expect(ANALYSIS_TRIGGER_TYPE.auto).toBe("AUTO");
    expect(ANALYSIS_TRIGGER_TYPE.manual).toBe("MANUAL");
  });
});

describe("analysis Zod schemas", () => {
  it("analysisStatusSchema accepts valid values", () => {
    expect(analysisStatusSchema.parse("ANALYZING")).toBe("ANALYZING");
    expect(analysisStatusSchema.parse("FAILED")).toBe("FAILED");
  });

  it("analysisStatusSchema rejects invalid values", () => {
    expect(() => analysisStatusSchema.parse("INVALID")).toThrow();
    expect(() => analysisStatusSchema.parse("")).toThrow();
  });

  it("draftStatusSchema accepts valid values", () => {
    expect(draftStatusSchema.parse("AWAITING_APPROVAL")).toBe("AWAITING_APPROVAL");
    expect(draftStatusSchema.parse("SENT")).toBe("SENT");
  });

  it("draftStatusSchema accepts GENERATING", () => {
    expect(draftStatusSchema.parse("GENERATING")).toBe("GENERATING");
  });
});

describe("agentOutputSchema", () => {
  const validAnalysis = {
    problemStatement: "Token expiry bug",
    likelySubsystem: "auth-service",
    severity: "HIGH",
    category: "BUG",
    confidence: 0.85,
    missingInfo: [],
    reasoningTrace: "Searched auth-service, found token handling code",
  };

  const validDraft = {
    body: "Hi, this is a known issue...",
    internalNotes: "Related to commit abc123",
    citations: [{ file: "auth.ts", line: 42, text: "token expiry" }],
    tone: "professional",
  };

  it("accepts analysis with draft", () => {
    const result = agentOutputSchema.parse({
      analysis: validAnalysis,
      draft: validDraft,
    });
    expect(result.analysis.confidence).toBe(0.85);
    expect(result.draft?.body).toContain("known issue");
  });

  it("accepts analysis without draft (null)", () => {
    const result = agentOutputSchema.parse({
      analysis: { ...validAnalysis, confidence: 0.3, missingInfo: ["error logs"] },
      draft: null,
    });
    expect(result.draft).toBeNull();
    expect(result.analysis.missingInfo).toEqual(["error logs"]);
  });

  it("rejects confidence > 1", () => {
    expect(() =>
      agentOutputSchema.parse({
        analysis: { ...validAnalysis, confidence: 1.5 },
        draft: null,
      })
    ).toThrow();
  });

  it("rejects confidence < 0", () => {
    expect(() =>
      agentOutputSchema.parse({
        analysis: { ...validAnalysis, confidence: -0.1 },
        draft: null,
      })
    ).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() =>
      agentOutputSchema.parse({
        analysis: { ...validAnalysis, severity: "EXTREME" },
        draft: null,
      })
    ).toThrow();
  });
});

describe("tRPC input schemas", () => {
  it("getLatestAnalysisInputSchema validates", () => {
    expect(getLatestAnalysisInputSchema.parse({ conversationId: "conv_1" })).toEqual({
      conversationId: "conv_1",
    });
  });

  it("approveDraftInputSchema accepts optional editedBody", () => {
    expect(approveDraftInputSchema.parse({ draftId: "dr_1" })).toEqual({ draftId: "dr_1" });
    expect(approveDraftInputSchema.parse({ draftId: "dr_1", editedBody: "edited text" })).toEqual({
      draftId: "dr_1",
      editedBody: "edited text",
    });
  });

  it("dismissDraftInputSchema accepts optional reason", () => {
    expect(dismissDraftInputSchema.parse({ draftId: "dr_1" })).toEqual({ draftId: "dr_1" });
    expect(dismissDraftInputSchema.parse({ draftId: "dr_1", reason: "Not relevant" })).toEqual({
      draftId: "dr_1",
      reason: "Not relevant",
    });
  });
});

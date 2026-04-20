import {
  ANALYSIS_STATUS,
  DRAFT_DISPATCH_STATUS,
  DRAFT_STATUS,
  MAX_ANALYSIS_RETRIES,
} from "@shared/types";
import {
  InvalidAnalysisTransitionError,
  InvalidDraftDispatchTransitionError,
  InvalidDraftTransitionError,
  canRetryAnalysis,
  createAnalysisContext,
  createDraftContext,
  createDraftDispatchContext,
  getAllowedAnalysisEvents,
  getAllowedDraftDispatchEvents,
  getAllowedDraftEvents,
  restoreAnalysisContext,
  transitionAnalysis,
  transitionDraft,
  transitionDraftDispatch,
} from "@shared/types";
import { describe, expect, it } from "vitest";

// ── Analysis State Machine ───────────────────────────────────────────

describe("analysis state machine", () => {
  it("starts in GATHERING_CONTEXT", () => {
    const ctx = createAnalysisContext("an_1");
    expect(ctx.status).toBe(ANALYSIS_STATUS.gatheringContext);
    expect(ctx.retryCount).toBe(0);
  });

  it("GATHERING_CONTEXT → contextReady → ANALYZING", () => {
    const ctx = createAnalysisContext("an_1");
    const next = transitionAnalysis(ctx, { type: "contextReady" });
    expect(next.status).toBe(ANALYSIS_STATUS.analyzing);
  });

  it("GATHERING_CONTEXT → failed → FAILED", () => {
    const ctx = createAnalysisContext("an_1");
    const next = transitionAnalysis(ctx, { type: "failed", error: "timeout" });
    expect(next.status).toBe(ANALYSIS_STATUS.failed);
    expect(next.errorMessage).toBe("timeout");
  });

  it("ANALYZING → analyzed → ANALYZED", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "contextReady" });
    const next = transitionAnalysis(ctx, {
      type: "analyzed",
      result: mockAnalysisResult(),
      draft: mockDraftResult(),
    });
    expect(next.status).toBe(ANALYSIS_STATUS.analyzed);
  });

  it("ANALYZING → needsContext → NEEDS_CONTEXT", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "contextReady" });
    const next = transitionAnalysis(ctx, {
      type: "needsContext",
      missingInfo: ["error logs"],
    });
    expect(next.status).toBe(ANALYSIS_STATUS.needsContext);
  });

  it("ANALYZING → failed → FAILED", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "contextReady" });
    const next = transitionAnalysis(ctx, { type: "failed", error: "agent crash" });
    expect(next.status).toBe(ANALYSIS_STATUS.failed);
    expect(next.errorMessage).toBe("agent crash");
  });

  it("FAILED → retry → GATHERING_CONTEXT (increments retryCount)", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "failed", error: "oops" });
    const next = transitionAnalysis(ctx, { type: "retry" });
    expect(next.status).toBe(ANALYSIS_STATUS.gatheringContext);
    expect(next.retryCount).toBe(1);
    expect(next.errorMessage).toBeNull();
  });

  it("NEEDS_CONTEXT → retry → GATHERING_CONTEXT (increments retryCount)", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "contextReady" });
    ctx = transitionAnalysis(ctx, { type: "needsContext", missingInfo: [] });
    const next = transitionAnalysis(ctx, { type: "retry" });
    expect(next.status).toBe(ANALYSIS_STATUS.gatheringContext);
    expect(next.retryCount).toBe(1);
  });

  it("FAILED → retry blocked after max retries", () => {
    const ctx = restoreAnalysisContext(
      "an_1",
      ANALYSIS_STATUS.failed,
      "persistent failure",
      MAX_ANALYSIS_RETRIES
    );
    expect(() => transitionAnalysis(ctx, { type: "retry" })).toThrow(
      InvalidAnalysisTransitionError
    );
  });

  it("ANALYZED is terminal — no transitions allowed", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "contextReady" });
    ctx = transitionAnalysis(ctx, {
      type: "analyzed",
      result: mockAnalysisResult(),
      draft: null,
    });
    expect(() => transitionAnalysis(ctx, { type: "retry" })).toThrow(
      InvalidAnalysisTransitionError
    );
  });

  it("rejects invalid transitions", () => {
    const ctx = createAnalysisContext("an_1");
    expect(() =>
      transitionAnalysis(ctx, {
        type: "analyzed",
        result: mockAnalysisResult(),
        draft: null,
      })
    ).toThrow(InvalidAnalysisTransitionError);
  });

  it("getAllowedAnalysisEvents reflects current state", () => {
    const ctx = createAnalysisContext("an_1");
    expect(getAllowedAnalysisEvents(ctx)).toEqual(["contextReady", "failed"]);
  });

  it("getAllowedAnalysisEvents returns empty for max-retry FAILED", () => {
    const ctx = restoreAnalysisContext("an_1", ANALYSIS_STATUS.failed, "err", MAX_ANALYSIS_RETRIES);
    expect(getAllowedAnalysisEvents(ctx)).toEqual([]);
  });

  it("canRetryAnalysis returns correct values", () => {
    const failedRetryable = restoreAnalysisContext("an_1", ANALYSIS_STATUS.failed, "err", 1);
    expect(canRetryAnalysis(failedRetryable)).toBe(true);

    const failedMaxed = restoreAnalysisContext(
      "an_1",
      ANALYSIS_STATUS.failed,
      "err",
      MAX_ANALYSIS_RETRIES
    );
    expect(canRetryAnalysis(failedMaxed)).toBe(false);

    const analyzed = restoreAnalysisContext("an_1", ANALYSIS_STATUS.analyzed, null, 0);
    expect(canRetryAnalysis(analyzed)).toBe(false);

    const needsCtx = restoreAnalysisContext("an_1", ANALYSIS_STATUS.needsContext, null, 0);
    expect(canRetryAnalysis(needsCtx)).toBe(true);
  });

  it("full happy path: trigger → gather → analyze → analyzed", () => {
    let ctx = createAnalysisContext("an_1");
    expect(ctx.status).toBe(ANALYSIS_STATUS.gatheringContext);

    ctx = transitionAnalysis(ctx, { type: "contextReady" });
    expect(ctx.status).toBe(ANALYSIS_STATUS.analyzing);

    ctx = transitionAnalysis(ctx, {
      type: "analyzed",
      result: mockAnalysisResult(),
      draft: mockDraftResult(),
    });
    expect(ctx.status).toBe(ANALYSIS_STATUS.analyzed);
    expect(ctx.retryCount).toBe(0);
  });

  it("retry loop: fail → retry → gather → fail → retry → gather", () => {
    let ctx = createAnalysisContext("an_1");
    ctx = transitionAnalysis(ctx, { type: "failed", error: "err1" });
    expect(ctx.retryCount).toBe(0);

    ctx = transitionAnalysis(ctx, { type: "retry" });
    expect(ctx.status).toBe(ANALYSIS_STATUS.gatheringContext);
    expect(ctx.retryCount).toBe(1);

    ctx = transitionAnalysis(ctx, { type: "failed", error: "err2" });
    ctx = transitionAnalysis(ctx, { type: "retry" });
    expect(ctx.retryCount).toBe(2);
  });
});

// ── Draft State Machine ──────────────────────────────────────────────

describe("draft state machine", () => {
  it("starts in GENERATING", () => {
    const ctx = createDraftContext("dr_1");
    expect(ctx.status).toBe(DRAFT_STATUS.generating);
  });

  it("GENERATING → generated → AWAITING_APPROVAL", () => {
    const ctx = createDraftContext("dr_1");
    const next = transitionDraft(ctx, { type: "generated" });
    expect(next.status).toBe(DRAFT_STATUS.awaitingApproval);
  });

  it("GENERATING → failed → FAILED", () => {
    const ctx = createDraftContext("dr_1");
    const next = transitionDraft(ctx, { type: "failed", error: "LLM error" });
    expect(next.status).toBe(DRAFT_STATUS.failed);
    expect(next.errorMessage).toBe("LLM error");
  });

  it("AWAITING_APPROVAL → approve → APPROVED", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    const next = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    expect(next.status).toBe(DRAFT_STATUS.approved);
  });

  it("AWAITING_APPROVAL → dismiss → DISMISSED", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    const next = transitionDraft(ctx, { type: "dismiss", reason: "Not relevant" });
    expect(next.status).toBe(DRAFT_STATUS.dismissed);
  });

  it("APPROVED → startSending → SENDING → sendSucceeded → SENT", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    expect(ctx.status).toBe(DRAFT_STATUS.sending);
    const next = transitionDraft(ctx, {
      type: "sendSucceeded",
      slackMessageTs: "1234567890.000100",
    });
    expect(next.status).toBe(DRAFT_STATUS.sent);
  });

  it("SENDING → sendFailed (retryable) → DELIVERY_UNKNOWN", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    const next = transitionDraft(ctx, {
      type: "sendFailed",
      error: "network timeout",
      retryable: true,
    });
    expect(next.status).toBe(DRAFT_STATUS.deliveryUnknown);
    expect(next.errorMessage).toBe("network timeout");
  });

  it("SENDING → sendFailed (permanent) → SEND_FAILED", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    const next = transitionDraft(ctx, {
      type: "sendFailed",
      error: "channel_archived",
      retryable: false,
    });
    expect(next.status).toBe(DRAFT_STATUS.sendFailed);
  });

  it("DELIVERY_UNKNOWN → reconcileFound → SENT", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    ctx = transitionDraft(ctx, {
      type: "sendFailed",
      error: "timeout",
      retryable: true,
    });
    const next = transitionDraft(ctx, {
      type: "reconcileFound",
      slackMessageTs: "1234567890.000100",
    });
    expect(next.status).toBe(DRAFT_STATUS.sent);
    expect(next.errorMessage).toBeNull();
  });

  it("SEND_FAILED → retry → APPROVED (allows re-send)", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    ctx = transitionDraft(ctx, {
      type: "sendFailed",
      error: "x",
      retryable: false,
    });
    const next = transitionDraft(ctx, { type: "retry" });
    expect(next.status).toBe(DRAFT_STATUS.approved);
  });

  it("APPROVED → failed → FAILED", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    const next = transitionDraft(ctx, { type: "failed", error: "Slack API down" });
    expect(next.status).toBe(DRAFT_STATUS.failed);
  });

  it("FAILED → retry → GENERATING", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "failed", error: "err" });
    const next = transitionDraft(ctx, { type: "retry" });
    expect(next.status).toBe(DRAFT_STATUS.generating);
    expect(next.errorMessage).toBeNull();
  });

  it("SENT is terminal", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    ctx = transitionDraft(ctx, {
      type: "sendSucceeded",
      slackMessageTs: "1234567890.000100",
    });
    expect(() => transitionDraft(ctx, { type: "retry" })).toThrow(InvalidDraftTransitionError);
  });

  it("DISMISSED is terminal", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "dismiss" });
    expect(() => transitionDraft(ctx, { type: "retry" })).toThrow(InvalidDraftTransitionError);
  });

  it("rejects invalid transitions", () => {
    const ctx = createDraftContext("dr_1");
    expect(() => transitionDraft(ctx, { type: "approve", approvedBy: "user_1" })).toThrow(
      InvalidDraftTransitionError
    );
  });

  it("getAllowedDraftEvents reflects current state", () => {
    const generating = createDraftContext("dr_1");
    expect(getAllowedDraftEvents(generating)).toEqual(["generated", "failed"]);

    const awaiting = transitionDraft(generating, { type: "generated" });
    expect(getAllowedDraftEvents(awaiting)).toEqual(["approve", "dismiss"]);
  });

  it("full happy path: generate → approve → startSending → sendSucceeded", () => {
    let ctx = createDraftContext("dr_1");
    ctx = transitionDraft(ctx, { type: "generated" });
    ctx = transitionDraft(ctx, { type: "approve", approvedBy: "user_1" });
    ctx = transitionDraft(ctx, { type: "startSending" });
    ctx = transitionDraft(ctx, {
      type: "sendSucceeded",
      slackMessageTs: "1234567890.000100",
    });
    expect(ctx.status).toBe(DRAFT_STATUS.sent);
  });
});

// ── Draft Dispatch FSM ───────────────────────────────────────────────

describe("DraftDispatch state machine", () => {
  it("starts in PENDING with attempts=0 and no error", () => {
    const ctx = createDraftDispatchContext("disp_1");
    expect(ctx.status).toBe(DRAFT_DISPATCH_STATUS.pending);
    expect(ctx.attempts).toBe(0);
    expect(ctx.lastError).toBeNull();
  });

  it("PENDING → dispatched → DISPATCHED clears any prior error", () => {
    const ctx = createDraftDispatchContext("disp_1");
    const next = transitionDraftDispatch(ctx, { type: "dispatched" });
    expect(next.status).toBe(DRAFT_DISPATCH_STATUS.dispatched);
    expect(next.lastError).toBeNull();
  });

  it("PENDING → dispatchFailed → FAILED increments attempts and records error", () => {
    const ctx = createDraftDispatchContext("disp_1");
    const next = transitionDraftDispatch(ctx, {
      type: "dispatchFailed",
      error: "Temporal unavailable",
    });
    expect(next.status).toBe(DRAFT_DISPATCH_STATUS.failed);
    expect(next.attempts).toBe(1);
    expect(next.lastError).toBe("Temporal unavailable");
  });

  it("DISPATCHED is terminal — no further transitions allowed", () => {
    let ctx = createDraftDispatchContext("disp_1");
    ctx = transitionDraftDispatch(ctx, { type: "dispatched" });
    expect(() => transitionDraftDispatch(ctx, { type: "dispatched" })).toThrow(
      InvalidDraftDispatchTransitionError
    );
    expect(() => transitionDraftDispatch(ctx, { type: "dispatchFailed", error: "x" })).toThrow(
      InvalidDraftDispatchTransitionError
    );
    expect(getAllowedDraftDispatchEvents(ctx)).toEqual([]);
  });

  it("FAILED is terminal today — no retry event exposed", () => {
    let ctx = createDraftDispatchContext("disp_1");
    ctx = transitionDraftDispatch(ctx, { type: "dispatchFailed", error: "x" });
    expect(() => transitionDraftDispatch(ctx, { type: "dispatched" })).toThrow(
      InvalidDraftDispatchTransitionError
    );
    expect(getAllowedDraftDispatchEvents(ctx)).toEqual([]);
  });

  it("getAllowedDraftDispatchEvents reflects current state", () => {
    const pending = createDraftDispatchContext("disp_1");
    expect([...getAllowedDraftDispatchEvents(pending)].sort()).toEqual(
      ["dispatchFailed", "dispatched"].sort()
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

function mockAnalysisResult() {
  return {
    problemStatement: "Token expiry bug",
    likelySubsystem: "auth-service",
    severity: "HIGH" as const,
    category: "BUG" as const,
    confidence: 0.85,
    missingInfo: [],
    reasoningTrace: "Searched auth-service code",
  };
}

function mockDraftResult() {
  return {
    body: "Hi, this is a known issue...",
    internalNotes: "Related to commit abc123",
    citations: [{ file: "auth.ts", line: 42, text: "token expiry" }],
    tone: "professional",
  };
}

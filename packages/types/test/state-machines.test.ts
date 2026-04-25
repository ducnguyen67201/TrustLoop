import {
  ANALYSIS_STATUS,
  DRAFT_DISPATCH_STATUS,
  DRAFT_STATUS,
  MAX_ANALYSIS_RETRIES,
  SUPPORT_CONVERSATION_STATUS,
} from "@shared/types";
import {
  InvalidAnalysisTransitionError,
  InvalidConversationTransitionError,
  InvalidDraftDispatchTransitionError,
  InvalidDraftTransitionError,
  canRetryAnalysis,
  createAnalysisContext,
  createConversationContext,
  createDraftContext,
  createDraftDispatchContext,
  getAllowedAnalysisEvents,
  getAllowedConversationEvents,
  getAllowedDraftDispatchEvents,
  getAllowedDraftEvents,
  restoreAnalysisContext,
  restoreConversationContext,
  transitionAnalysis,
  transitionConversation,
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

// ── Conversation State Machine ───────────────────────────────────────

describe("conversation state machine", () => {
  const ACTOR = "u_operator_1";

  it("starts in UNREAD", () => {
    const ctx = createConversationContext("c_1");
    expect(ctx.status).toBe(SUPPORT_CONVERSATION_STATUS.unread);
  });

  // Happy paths per §4 transition table — one assertion per cell.

  describe("UNREAD", () => {
    const ctx = () => createConversationContext("c_1");

    it("customerMessageReceived stays UNREAD", () => {
      const next = transitionConversation(ctx(), { type: "customerMessageReceived" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.unread);
    });

    it("operatorReplied → IN_PROGRESS", () => {
      const next = transitionConversation(ctx(), { type: "operatorReplied" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("operatorSetDone (deliveryConfirmed=true) → DONE", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetDone",
        actorUserId: ACTOR,
        deliveryConfirmed: true,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("operatorSetDone (deliveryConfirmed=false) throws", () => {
      expect(() =>
        transitionConversation(ctx(), {
          type: "operatorSetDone",
          actorUserId: ACTOR,
          deliveryConfirmed: false,
        })
      ).toThrow(InvalidConversationTransitionError);
    });

    it("operatorSetStale → STALE", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetStale",
        actorUserId: ACTOR,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.stale);
    });

    it("markStale → STALE", () => {
      const next = transitionConversation(ctx(), { type: "markStale" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.stale);
    });

    it("operatorOverrideDone → DONE without evidence", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorOverrideDone",
        actorUserId: ACTOR,
        overrideReason: "customer confirmed via call",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("operatorCloseAsNoAction → DONE", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorCloseAsNoAction",
        actorUserId: ACTOR,
        agentTeamRunId: "atr_1",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("analysisEscalated → IN_PROGRESS", () => {
      const next = transitionConversation(ctx(), {
        type: "analysisEscalated",
        analysisId: "an_1",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });
  });

  describe("IN_PROGRESS", () => {
    const ctx = () => restoreConversationContext("c_1", SUPPORT_CONVERSATION_STATUS.inProgress);

    it("customerMessageReceived stays IN_PROGRESS", () => {
      const next = transitionConversation(ctx(), { type: "customerMessageReceived" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("operatorReplied is idempotent (stays IN_PROGRESS)", () => {
      const next = transitionConversation(ctx(), { type: "operatorReplied" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("analysisEscalated is idempotent (stays IN_PROGRESS)", () => {
      const next = transitionConversation(ctx(), {
        type: "analysisEscalated",
        analysisId: "an_1",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("operatorSetUnread → UNREAD (operator demote)", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetUnread",
        actorUserId: ACTOR,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.unread);
    });

    it("operatorSetDone (deliveryConfirmed=true) → DONE", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetDone",
        actorUserId: ACTOR,
        deliveryConfirmed: true,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("markStale → STALE", () => {
      const next = transitionConversation(ctx(), { type: "markStale" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.stale);
    });
  });

  describe("STALE", () => {
    const ctx = () => restoreConversationContext("c_1", SUPPORT_CONVERSATION_STATUS.stale);

    it("customerMessageReceived → UNREAD (reopen)", () => {
      const next = transitionConversation(ctx(), { type: "customerMessageReceived" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.unread);
    });

    it("operatorReplied → IN_PROGRESS", () => {
      const next = transitionConversation(ctx(), { type: "operatorReplied" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("operatorSetInProgress → IN_PROGRESS (operator drags card off Stale)", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetInProgress",
        actorUserId: ACTOR,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("analysisEscalated → IN_PROGRESS", () => {
      const next = transitionConversation(ctx(), {
        type: "analysisEscalated",
        analysisId: "an_1",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("markStale throws (sweep should never re-mark already-stale)", () => {
      expect(() => transitionConversation(ctx(), { type: "markStale" })).toThrow(
        InvalidConversationTransitionError
      );
    });
  });

  describe("DONE", () => {
    const ctx = () => restoreConversationContext("c_1", SUPPORT_CONVERSATION_STATUS.done);

    it("customerMessageReceived → UNREAD (auto-reopen matches ingress today)", () => {
      const next = transitionConversation(ctx(), { type: "customerMessageReceived" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.unread);
    });

    it("operatorReplied preserves DONE (race fix regression)", () => {
      // This is the idempotent half of the reply-race fix. The writer uses
      // a conditional updateMany `where: status != DONE` so a concurrent
      // markDoneWithOverride wins; the FSM must also make DONE+operatorReplied
      // a legal no-op so next.status can be evaluated before the write.
      const next = transitionConversation(ctx(), { type: "operatorReplied" });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("operatorSetInProgress → IN_PROGRESS (operator reopens)", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetInProgress",
        actorUserId: ACTOR,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.inProgress);
    });

    it("operatorSetDone (deliveryConfirmed=true) is idempotent", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorSetDone",
        actorUserId: ACTOR,
        deliveryConfirmed: true,
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("operatorOverrideDone is idempotent", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorOverrideDone",
        actorUserId: ACTOR,
        overrideReason: "cleanup",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("operatorCloseAsNoAction is idempotent on DONE", () => {
      const next = transitionConversation(ctx(), {
        type: "operatorCloseAsNoAction",
        actorUserId: ACTOR,
        agentTeamRunId: "atr_1",
      });
      expect(next.status).toBe(SUPPORT_CONVERSATION_STATUS.done);
    });

    it("analysisEscalated THROWS (escalation-overwrites-DONE bug fix)", () => {
      // This is the regression for bug #2. Previously
      // escalateToManualHandling wrote status: IN_PROGRESS unconditionally.
      // The FSM rejects the event from DONE; the activity catches the typed
      // error and exits cleanly.
      expect(() =>
        transitionConversation(ctx(), { type: "analysisEscalated", analysisId: "an_1" })
      ).toThrow(InvalidConversationTransitionError);
    });

    it("markStale THROWS (closed conversations are not sweep targets)", () => {
      expect(() => transitionConversation(ctx(), { type: "markStale" })).toThrow(
        InvalidConversationTransitionError
      );
    });
  });

  describe("getAllowedConversationEvents", () => {
    it("UNREAD allows all operator moves + markStale + analysisEscalated", () => {
      const allowed = new Set(getAllowedConversationEvents(createConversationContext("c_1")));
      expect(allowed).toContain("customerMessageReceived");
      expect(allowed).toContain("operatorReplied");
      expect(allowed).toContain("operatorSetDone");
      expect(allowed).toContain("markStale");
      expect(allowed).toContain("analysisEscalated");
    });

    it("DONE does NOT list markStale or analysisEscalated", () => {
      const allowed = new Set(
        getAllowedConversationEvents(
          restoreConversationContext("c_1", SUPPORT_CONVERSATION_STATUS.done)
        )
      );
      expect(allowed).not.toContain("markStale");
      expect(allowed).not.toContain("analysisEscalated");
      expect(allowed).toContain("operatorReplied");
      expect(allowed).toContain("customerMessageReceived");
    });

    it("STALE does NOT list markStale (sweep guard)", () => {
      const allowed = new Set(
        getAllowedConversationEvents(
          restoreConversationContext("c_1", SUPPORT_CONVERSATION_STATUS.stale)
        )
      );
      expect(allowed).not.toContain("markStale");
    });
  });
});

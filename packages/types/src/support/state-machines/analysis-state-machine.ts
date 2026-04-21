import { defineFsm } from "@shared/types/fsm";
import {
  ANALYSIS_STATUS,
  type AnalysisResult,
  type DraftResult,
  MAX_ANALYSIS_RETRIES,
} from "../support-analysis.schema";

// ── Types ────────────────────────────────────────────────────────────

type AnalysisStatusValue = (typeof ANALYSIS_STATUS)[keyof typeof ANALYSIS_STATUS];

export interface AnalysisContext {
  analysisId: string;
  status: AnalysisStatusValue;
  errorMessage: string | null;
  retryCount: number;
}

export type AnalysisEvent =
  | { type: "trigger" }
  | { type: "contextReady" }
  | { type: "analyzed"; result: AnalysisResult; draft: DraftResult | null }
  | { type: "needsContext"; missingInfo: string[] }
  | { type: "failed"; error: string }
  | { type: "retry" };

type AnalysisEventType = AnalysisEvent["type"];

// Preserved for back-compat: activity code does
// `err instanceof InvalidAnalysisTransitionError` to decide retry behavior.
export class InvalidAnalysisTransitionError extends Error {
  constructor(from: AnalysisStatusValue, event: AnalysisEventType) {
    super(`Invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidAnalysisTransitionError";
  }
}

// ── FSM Definition ───────────────────────────────────────────────────

const analysisFsm = defineFsm<AnalysisStatusValue, AnalysisEvent, AnalysisContext>({
  name: "Analysis",
  initial: ANALYSIS_STATUS.gatheringContext,
  errorFactory: (_fsm, from, event) =>
    new InvalidAnalysisTransitionError(from as AnalysisStatusValue, event as AnalysisEventType),
  states: {
    [ANALYSIS_STATUS.gatheringContext]: {
      on: {
        contextReady: (ctx) => ({ ...ctx, status: ANALYSIS_STATUS.analyzing }),
        failed: (ctx, event) => ({
          ...ctx,
          status: ANALYSIS_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    [ANALYSIS_STATUS.analyzing]: {
      on: {
        analyzed: (ctx) => ({ ...ctx, status: ANALYSIS_STATUS.analyzed }),
        needsContext: (ctx) => ({ ...ctx, status: ANALYSIS_STATUS.needsContext }),
        failed: (ctx, event) => ({
          ...ctx,
          status: ANALYSIS_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    [ANALYSIS_STATUS.analyzed]: { on: {} },

    [ANALYSIS_STATUS.needsContext]: {
      on: {
        retry: (ctx) => ({
          ...ctx,
          status: ANALYSIS_STATUS.gatheringContext,
          retryCount: ctx.retryCount + 1,
          errorMessage: null,
        }),
      },
    },

    // FAILED allows `retry` — but only while retryCount < MAX_ANALYSIS_RETRIES.
    // Expressed as a dynamic guard so `transitionAnalysis` and
    // `getAllowedAnalysisEvents` both respect the cap without duplicating logic.
    [ANALYSIS_STATUS.failed]: {
      on: {
        retry: (ctx) => ({
          ...ctx,
          status: ANALYSIS_STATUS.gatheringContext,
          retryCount: ctx.retryCount + 1,
          errorMessage: null,
        }),
      },
      guardEvents: (ctx) =>
        ctx.retryCount >= MAX_ANALYSIS_RETRIES
          ? new Set<AnalysisEventType>()
          : new Set<AnalysisEventType>(["retry"]),
    },
  },
});

// ── Public API ───────────────────────────────────────────────────────

export function createAnalysisContext(analysisId: string): AnalysisContext {
  return {
    analysisId,
    status: ANALYSIS_STATUS.gatheringContext,
    errorMessage: null,
    retryCount: 0,
  };
}

export function restoreAnalysisContext(
  analysisId: string,
  status: AnalysisStatusValue,
  errorMessage: string | null,
  retryCount: number
): AnalysisContext {
  return { analysisId, status, errorMessage, retryCount };
}

export function transitionAnalysis(
  context: AnalysisContext,
  event: AnalysisEvent
): AnalysisContext {
  return analysisFsm.transition(context, event);
}

export function getAllowedAnalysisEvents(context: AnalysisContext): readonly AnalysisEventType[] {
  return analysisFsm.allowedEvents(context);
}

// Preserved as an explicit helper — its exact original semantics include
// blocking retry on `needsContext` past MAX_ANALYSIS_RETRIES, which the FSM
// `allowedEvents` does not enforce (only `failed` has the guard). Keeping
// this function keeps callers' UI hints consistent with the original.
export function canRetryAnalysis(context: AnalysisContext): boolean {
  return (
    (context.status === ANALYSIS_STATUS.failed ||
      context.status === ANALYSIS_STATUS.needsContext) &&
    context.retryCount < MAX_ANALYSIS_RETRIES
  );
}

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

export class InvalidAnalysisTransitionError extends Error {
  constructor(from: AnalysisStatusValue, event: AnalysisEventType) {
    super(`Invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidAnalysisTransitionError";
  }
}

// ── State Interface ────────────────────────────────────────────────��─

interface AnalysisState {
  readonly status: AnalysisStatusValue;
  readonly allowedEvents: readonly AnalysisEventType[];
  handle(event: AnalysisEvent, context: AnalysisContext): AnalysisContext;
}

// ── Concrete States ──────────────────────────────────────────────────

const gatheringContextState: AnalysisState = {
  status: ANALYSIS_STATUS.gatheringContext,
  allowedEvents: ["contextReady", "failed"],
  handle(event, context) {
    switch (event.type) {
      case "contextReady":
        return { ...context, status: ANALYSIS_STATUS.analyzing };
      case "failed":
        return {
          ...context,
          status: ANALYSIS_STATUS.failed,
          errorMessage: event.error,
        };
      default:
        throw new InvalidAnalysisTransitionError(this.status, event.type);
    }
  },
};

const analyzingState: AnalysisState = {
  status: ANALYSIS_STATUS.analyzing,
  allowedEvents: ["analyzed", "needsContext", "failed"],
  handle(event, context) {
    switch (event.type) {
      case "analyzed":
        return { ...context, status: ANALYSIS_STATUS.analyzed };
      case "needsContext":
        return { ...context, status: ANALYSIS_STATUS.needsContext };
      case "failed":
        return {
          ...context,
          status: ANALYSIS_STATUS.failed,
          errorMessage: event.error,
        };
      default:
        throw new InvalidAnalysisTransitionError(this.status, event.type);
    }
  },
};

const analyzedState: AnalysisState = {
  status: ANALYSIS_STATUS.analyzed,
  allowedEvents: [],
  handle(event, context) {
    throw new InvalidAnalysisTransitionError(this.status, event.type);
  },
};

const needsContextState: AnalysisState = {
  status: ANALYSIS_STATUS.needsContext,
  allowedEvents: ["retry"],
  handle(event, context) {
    if (event.type === "retry") {
      return {
        ...context,
        status: ANALYSIS_STATUS.gatheringContext,
        retryCount: context.retryCount + 1,
        errorMessage: null,
      };
    }
    throw new InvalidAnalysisTransitionError(this.status, event.type);
  },
};

const failedState: AnalysisState = {
  status: ANALYSIS_STATUS.failed,
  allowedEvents: ["retry"],
  handle(event, context) {
    if (event.type === "retry") {
      if (context.retryCount >= MAX_ANALYSIS_RETRIES) {
        throw new InvalidAnalysisTransitionError(this.status, event.type);
      }
      return {
        ...context,
        status: ANALYSIS_STATUS.gatheringContext,
        retryCount: context.retryCount + 1,
        errorMessage: null,
      };
    }
    throw new InvalidAnalysisTransitionError(this.status, event.type);
  },
};

// ── State Registry ──────────────────────────────────────────────────���

const STATE_MAP: Record<AnalysisStatusValue, AnalysisState> = {
  [ANALYSIS_STATUS.gatheringContext]: gatheringContextState,
  [ANALYSIS_STATUS.analyzing]: analyzingState,
  [ANALYSIS_STATUS.analyzed]: analyzedState,
  [ANALYSIS_STATUS.needsContext]: needsContextState,
  [ANALYSIS_STATUS.failed]: failedState,
};

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
  const state = STATE_MAP[context.status];
  if (!state) {
    throw new Error(`Unknown analysis status: ${context.status}`);
  }
  return state.handle(event, context);
}

export function getAllowedAnalysisEvents(context: AnalysisContext): readonly AnalysisEventType[] {
  const state = STATE_MAP[context.status];
  if (!state) return [];
  if (context.status === ANALYSIS_STATUS.failed && context.retryCount >= MAX_ANALYSIS_RETRIES) {
    return [];
  }
  return state.allowedEvents;
}

export function canRetryAnalysis(context: AnalysisContext): boolean {
  return (
    (context.status === ANALYSIS_STATUS.failed ||
      context.status === ANALYSIS_STATUS.needsContext) &&
    context.retryCount < MAX_ANALYSIS_RETRIES
  );
}

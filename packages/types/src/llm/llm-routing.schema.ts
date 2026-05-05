import { z } from "zod";
import { MODEL_CONFIG } from "../model-config";

export const LLM_PROVIDER = {
  openai: "openai",
  openrouter: "openrouter",
} as const;

export const llmProviderValues = [LLM_PROVIDER.openai, LLM_PROVIDER.openrouter] as const;

export const llmProviderSchema = z.enum(llmProviderValues);

/*
 * --------------------------------------------------------------------------
 * Queue / REST Model Declarations
 * --------------------------------------------------------------------------
 */

export const QUEUE_LLM_USE_CASE = {
  supportAnalysis: "support-analysis",
  supportSummary: "support-summary",
  codexRerank: "codex-rerank",
  codexEmbedding: "codex-embedding",
  frameCaption: "frame-caption",
} as const;

/*
 * --------------------------------------------------------------------------
 * Agent Service Model Declarations
 * --------------------------------------------------------------------------
 */

export const AGENT_SERVICE_LLM_USE_CASE = {
  agentTeamArchitect: "agent-team-architect",
  agentTeamReviewer: "agent-team-reviewer",
  agentTeamCodeReader: "agent-team-code-reader",
  agentTeamPrCreator: "agent-team-pr-creator",
  agentTeamRcaAnalyst: "agent-team-rca-analyst",
} as const;

export const LLM_USE_CASE = {
  ...QUEUE_LLM_USE_CASE,
  ...AGENT_SERVICE_LLM_USE_CASE,
} as const;

export const queueLlmUseCaseValues = [
  QUEUE_LLM_USE_CASE.supportAnalysis,
  QUEUE_LLM_USE_CASE.supportSummary,
  QUEUE_LLM_USE_CASE.codexRerank,
  QUEUE_LLM_USE_CASE.codexEmbedding,
  QUEUE_LLM_USE_CASE.frameCaption,
] as const;

export const agentServiceLlmUseCaseValues = [
  AGENT_SERVICE_LLM_USE_CASE.agentTeamArchitect,
  AGENT_SERVICE_LLM_USE_CASE.agentTeamReviewer,
  AGENT_SERVICE_LLM_USE_CASE.agentTeamCodeReader,
  AGENT_SERVICE_LLM_USE_CASE.agentTeamPrCreator,
  AGENT_SERVICE_LLM_USE_CASE.agentTeamRcaAnalyst,
] as const;

export const llmUseCaseValues = [
  ...queueLlmUseCaseValues,
  ...agentServiceLlmUseCaseValues,
] as const;

export const llmUseCaseSchema = z.enum(llmUseCaseValues);

export const llmRouteTargetSchema = z.object({
  provider: llmProviderSchema,
  model: z.string().min(1),
});

export const llmRouteSchema = z.object({
  useCase: llmUseCaseSchema,
  primary: llmRouteTargetSchema,
  fallbacks: z.array(llmRouteTargetSchema),
});

export const llmOverrideSchema = z.object({
  provider: llmProviderSchema.optional(),
  model: z.string().min(1).optional(),
});

export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type LlmUseCase = z.infer<typeof llmUseCaseSchema>;
export type LlmRouteTarget = z.infer<typeof llmRouteTargetSchema>;
export type LlmRoute = z.infer<typeof llmRouteSchema>;
export type LlmOverride = z.infer<typeof llmOverrideSchema>;

export const LLM_USE_CASE_DEFAULTS: Record<
  LlmUseCase,
  {
    model: string;
    primaryProvider: LlmProvider;
    fallbackProviders: readonly LlmProvider[];
  }
> = {
  // Queue / REST model defaults.
  [LLM_USE_CASE.supportAnalysis]: {
    model: MODEL_CONFIG.agent,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.supportSummary]: {
    model: MODEL_CONFIG.summary,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.codexRerank]: {
    model: MODEL_CONFIG.fast,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.codexEmbedding]: {
    // Embedding vectors must keep a stable dimension for pgvector columns.
    // Until we explicitly validate another provider/model pair, stay on
    // OpenAI only here.
    model: MODEL_CONFIG.embedding,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [],
  },
  [LLM_USE_CASE.frameCaption]: {
    // Vision captioner for failure-frame screenshots. MODEL_CONFIG.fast is
    // gpt-4o-mini, which is vision-capable. OpenRouter relays the same model
    // for fallback when OpenAI is unavailable.
    model: MODEL_CONFIG.fast,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },

  // Agent service model defaults.
  [LLM_USE_CASE.agentTeamArchitect]: {
    model: MODEL_CONFIG.agent,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.agentTeamReviewer]: {
    model: MODEL_CONFIG.agent,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.agentTeamCodeReader]: {
    model: MODEL_CONFIG.agent,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.agentTeamPrCreator]: {
    model: MODEL_CONFIG.agent,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
  [LLM_USE_CASE.agentTeamRcaAnalyst]: {
    model: MODEL_CONFIG.agent,
    primaryProvider: LLM_PROVIDER.openai,
    fallbackProviders: [LLM_PROVIDER.openrouter],
  },
};

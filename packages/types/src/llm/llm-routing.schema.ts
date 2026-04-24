import { z } from "zod";
import { MODEL_CONFIG } from "../model-config";

export const LLM_PROVIDER = {
  openai: "openai",
  openrouter: "openrouter",
} as const;

export const llmProviderValues = [LLM_PROVIDER.openai, LLM_PROVIDER.openrouter] as const;

export const llmProviderSchema = z.enum(llmProviderValues);

export const LLM_USE_CASE = {
  supportAnalysis: "support-analysis",
  supportSummary: "support-summary",
  codexRerank: "codex-rerank",
  codexEmbedding: "codex-embedding",
} as const;

export const llmUseCaseValues = [
  LLM_USE_CASE.supportAnalysis,
  LLM_USE_CASE.supportSummary,
  LLM_USE_CASE.codexRerank,
  LLM_USE_CASE.codexEmbedding,
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
};

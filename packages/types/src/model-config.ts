/**
 * Centralized LLM model configuration.
 *
 * All model references across agents, queue, and rest should import from here.
 * Change a model in one place, every workflow picks it up.
 *
 *   packages/types/src/model-config.ts  (this file — source of truth)
 *       ↓
 *   apps/agents   → agent reasoning (support analysis)
 *   apps/queue    → future workflow LLM calls
 *   packages/rest → embedding generation, search reranking
 */

export const MODEL_CONFIG = {
  /** Primary agent model for reasoning, analysis, and drafting. */
  agent: "gpt-4o",

  /** Cheap summary model for inbox-card labels and short structured output. */
  summary: "gpt-4.1-mini",

  /** Fast/cheap model for reranking search results, classification, etc. */
  fast: "gpt-4o-mini",

  /** Embedding model for vector search. Dimension: 1536. */
  embedding: "text-embedding-3-small",

  /** Embedding output dimensions. Must match pgvector column definition. */
  embeddingDimensions: 1536,
} as const;

export type ModelConfigKey = keyof typeof MODEL_CONFIG;

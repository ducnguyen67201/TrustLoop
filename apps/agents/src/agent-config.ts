import { type LlmOverride, llmOverrideSchema } from "@shared/types";

export function resolveProviderConfig(config?: {
  provider?: unknown;
  model?: unknown;
}): LlmOverride | undefined {
  const override = llmOverrideSchema.parse({
    provider: config?.provider,
    model: config?.model,
  });

  return override.provider || override.model ? override : undefined;
}

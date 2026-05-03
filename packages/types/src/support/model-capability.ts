import { AGENT_PROVIDER } from "./agent-provider.schema";

// Model name patterns known to support multimodal image input. Maintained as
// pattern lists rather than fixed enums so newly-released vision models work
// without a code change. Conservative — if unsure, return false and fall back
// to the captioner pipeline.
const VISION_CAPABLE_PATTERNS: Record<string, RegExp[]> = {
  [AGENT_PROVIDER.openai]: [
    /^gpt-4o(?!-mini-realtime)/i, // 4o family except niche realtime variants
    /^gpt-4-turbo/i,
    /^gpt-4-vision/i,
    /^gpt-5/i,
    /^o1/i,
    /^o3/i,
  ],
  // openrouter routes to many providers under heterogeneous slugs
  // (e.g. `anthropic/claude-3.5-sonnet`, `google/gemini-...`). Leave empty for
  // now — falsely returning false here just runs the captioner pipeline,
  // which is acceptable. Add patterns once we have a per-workspace model
  // picker so the slugs in scope are known.
  [AGENT_PROVIDER.openrouter]: [],
};

const TEXT_ONLY_OVERRIDES: Record<string, RegExp[]> = {
  [AGENT_PROVIDER.openai]: [
    /^gpt-4o-mini$/i, // small variant is text-only despite the 4o naming
  ],
  [AGENT_PROVIDER.openrouter]: [],
};

/**
 * Best-effort vision capability check for a given provider+model. Returns
 * true only when the model is known to accept multimodal image input. Used
 * by the workflow to decide whether to send raw images or run the captioner
 * pipeline. False negatives mean an extra captioner LLM hop, which is
 * acceptable; false positives mean a model rejects an image and the analysis
 * fails, which is not. Therefore: be conservative.
 */
export function isVisionCapable(provider: string, model: string | null | undefined): boolean {
  if (!model) return false;

  const overrides = TEXT_ONLY_OVERRIDES[provider] ?? [];
  if (overrides.some((rx) => rx.test(model))) return false;

  const patterns = VISION_CAPABLE_PATTERNS[provider] ?? [];
  return patterns.some((rx) => rx.test(model));
}

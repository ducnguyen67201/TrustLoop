import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = {
  OPENAI_API_KEY: "openai-test-key",
  OPENROUTER_API_KEY: "openrouter-test-key",
  APP_BASE_URL: "http://localhost:3000",
  APP_PUBLIC_URL: undefined as string | undefined,
};

vi.mock("@shared/env", () => ({
  env: envState,
}));

vi.mock("openai", () => ({
  default: vi.fn(),
}));

const { requireRoute, resolveRoute } = await import("../src/services/llm-manager-service");
const { LLM_PROVIDER, LLM_USE_CASE } = await import("@shared/types");

describe("llm-manager-service", () => {
  beforeEach(() => {
    envState.OPENAI_API_KEY = "openai-test-key";
    envState.OPENROUTER_API_KEY = "openrouter-test-key";
    envState.APP_BASE_URL = "http://localhost:3000";
    envState.APP_PUBLIC_URL = undefined;
  });

  it("prefers OpenAI and keeps OpenRouter as the fallback for support analysis", () => {
    const route = requireRoute(LLM_USE_CASE.supportAnalysis);

    expect(route.targets[0].provider).toBe(LLM_PROVIDER.openai);
    expect(route.targets[0].model).toBe("gpt-4o");
    expect(route.targets[1]?.provider).toBe(LLM_PROVIDER.openrouter);
    expect(route.targets[1]?.apiModel).toBe("openai/gpt-4o");
  });

  it("promotes OpenRouter when OpenAI is unavailable", () => {
    envState.OPENAI_API_KEY = "";

    const route = requireRoute(LLM_USE_CASE.supportSummary);

    expect(route.targets).toHaveLength(1);
    expect(route.targets[0].provider).toBe(LLM_PROVIDER.openrouter);
    expect(route.targets[0].apiModel).toBe("openai/gpt-4.1-mini");
    expect(route.targets[0].headers?.["HTTP-Referer"]).toBe("http://localhost:3000");
  });

  it("keeps embeddings on OpenAI-only until another provider is explicitly validated", () => {
    envState.OPENAI_API_KEY = "";

    expect(resolveRoute(LLM_USE_CASE.codexEmbedding)).toBeNull();
  });

  it("treats an explicit provider override as a pin, not a multi-provider route", () => {
    const route = requireRoute(LLM_USE_CASE.supportAnalysis, {
      provider: LLM_PROVIDER.openrouter,
      model: "gpt-4o",
    });

    expect(route.targets).toHaveLength(1);
    expect(route.targets[0].provider).toBe(LLM_PROVIDER.openrouter);
    expect(route.targets[0].apiModel).toBe("openai/gpt-4o");
  });
});

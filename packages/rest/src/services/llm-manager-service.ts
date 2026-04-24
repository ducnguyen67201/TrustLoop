import { env } from "@shared/env";
import {
  LLM_PROVIDER,
  LLM_USE_CASE_DEFAULTS,
  type LlmOverride,
  type LlmProvider,
  type LlmUseCase,
} from "@shared/types";
import OpenAI from "openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_TITLE = "TrustLoop";

interface ProviderRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface LlmResolvedTarget {
  provider: LlmProvider;
  model: string;
  apiModel: string;
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface LlmResolvedRoute {
  useCase: LlmUseCase;
  targets: readonly [LlmResolvedTarget, ...LlmResolvedTarget[]];
}

export class LlmRouteConfigurationError extends Error {
  constructor(useCase: LlmUseCase) {
    super(
      `No LLM provider is configured for ${useCase}. Configure OPENAI_API_KEY or OPENROUTER_API_KEY.`
    );
    this.name = "LlmRouteConfigurationError";
  }
}

export class LlmRouteExecutionError extends Error {
  readonly failures: Array<{ provider: LlmProvider; model: string; message: string }>;

  constructor(
    useCase: LlmUseCase,
    failures: Array<{ provider: LlmProvider; model: string; message: string }>
  ) {
    super(
      `All configured LLM providers failed for ${useCase}: ${failures
        .map((failure) => `${failure.provider}/${failure.model}: ${failure.message}`)
        .join("; ")}`
    );
    this.name = "LlmRouteExecutionError";
    this.failures = failures;
  }
}

export function isProviderConfigured(provider: LlmProvider): boolean {
  return getProviderRuntimeConfig(provider) !== null;
}

export function hasRouteForUseCase(useCase: LlmUseCase, override?: LlmOverride): boolean {
  return resolveRoute(useCase, override) !== null;
}

export function resolveRoute(useCase: LlmUseCase, override?: LlmOverride): LlmResolvedRoute | null {
  const defaults = LLM_USE_CASE_DEFAULTS[useCase];
  const candidateProviders = override?.provider
    ? [override.provider]
    : [defaults.primaryProvider, ...defaults.fallbackProviders];
  const model = override?.model ?? defaults.model;

  const targets = dedupeProviders(candidateProviders)
    .map((provider) => {
      const runtime = getProviderRuntimeConfig(provider);
      if (!runtime) {
        return null;
      }

      return {
        provider,
        model,
        apiModel: resolveProviderModel(provider, model),
        ...runtime,
      } satisfies LlmResolvedTarget;
    })
    .filter((target): target is LlmResolvedTarget => target !== null);

  const [primary, ...fallbacks] = targets;
  if (!primary) {
    return null;
  }

  return {
    useCase,
    targets: [primary, ...fallbacks],
  };
}

export function requireRoute(useCase: LlmUseCase, override?: LlmOverride): LlmResolvedRoute {
  const route = resolveRoute(useCase, override);
  if (!route) {
    throw new LlmRouteConfigurationError(useCase);
  }
  return route;
}

export function createOpenAiCompatibleClient(target: LlmResolvedTarget): OpenAI {
  const cacheKey = `${target.provider}:${target.baseURL ?? "default"}:${target.apiKey}`;
  const cached = openAiClientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new OpenAI({
    apiKey: target.apiKey,
    ...(target.baseURL ? { baseURL: target.baseURL } : {}),
    ...(target.headers ? { defaultHeaders: target.headers } : {}),
  });
  openAiClientCache.set(cacheKey, client);
  return client;
}

export async function executeWithFallback<T>(
  route: LlmResolvedRoute,
  operation: (target: LlmResolvedTarget) => Promise<T>
): Promise<{ result: T; target: LlmResolvedTarget }> {
  const failures: Array<{ provider: LlmProvider; model: string; message: string }> = [];

  for (const target of route.targets) {
    try {
      return {
        result: await operation(target),
        target,
      };
    } catch (error) {
      failures.push({
        provider: target.provider,
        model: target.model,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new LlmRouteExecutionError(route.useCase, failures);
}

function getProviderRuntimeConfig(provider: LlmProvider): ProviderRuntimeConfig | null {
  switch (provider) {
    case LLM_PROVIDER.openai:
      return env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : null;

    case LLM_PROVIDER.openrouter:
      if (!env.OPENROUTER_API_KEY) {
        return null;
      }

      return {
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: OPENROUTER_BASE_URL,
        headers: {
          "HTTP-Referer": env.APP_PUBLIC_URL ?? env.APP_BASE_URL,
          "X-OpenRouter-Title": OPENROUTER_TITLE,
        },
      };
  }
}

function resolveProviderModel(provider: LlmProvider, model: string): string {
  if (provider === LLM_PROVIDER.openrouter && !model.includes("/")) {
    // Our canonical model IDs are plain OpenAI model names today. OpenRouter
    // expects provider-qualified slugs for these same models.
    return `openai/${model}`;
  }

  return model;
}

function dedupeProviders(providers: readonly LlmProvider[]): LlmProvider[] {
  const seen = new Set<LlmProvider>();
  const deduped: LlmProvider[] = [];

  for (const provider of providers) {
    if (seen.has(provider)) {
      continue;
    }

    seen.add(provider);
    deduped.push(provider);
  }

  return deduped;
}

const openAiClientCache = new Map<string, OpenAI>();

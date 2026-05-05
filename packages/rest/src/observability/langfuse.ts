import { env } from "@shared/env";
import { Langfuse, observeOpenAI } from "langfuse";
import type OpenAI from "openai";

// Singleton client — Langfuse internally batches and flushes events on a
// timer, so reusing one instance across the process is the supported pattern.
let cachedClient: Langfuse | null | undefined;

/**
 * Returns the Langfuse client when public/secret keys are configured.
 * Returns null when keys are absent so call sites can skip instrumentation
 * gracefully without sprinkling env checks everywhere.
 */
export function getLangfuseClient(): Langfuse | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new Langfuse({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    ...(env.LANGFUSE_BASEURL ? { baseUrl: env.LANGFUSE_BASEURL } : {}),
  });
  return cachedClient;
}

/**
 * Wraps an OpenAI client with Langfuse tracing when keys are configured.
 * Pass-through (returns the original client) when keys are absent so that
 * production deploys without Langfuse remain a zero-cost code path.
 */
export function maybeObserveOpenAI(client: OpenAI): OpenAI {
  if (!getLangfuseClient()) {
    return client;
  }
  return observeOpenAI(client) as unknown as OpenAI;
}

/**
 * Flushes pending Langfuse events. Call from request handlers that are about
 * to return so traces show up promptly during local development. In long-lived
 * processes the periodic flush would catch up eventually anyway.
 */
export async function flushLangfuse(): Promise<void> {
  const client = getLangfuseClient();
  if (!client) {
    return;
  }
  await client.flushAsync();
}

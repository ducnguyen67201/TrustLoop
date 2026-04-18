import { env } from "@shared/env";

/**
 * Connection options accepted by both `@temporalio/client` Connection and
 * `@temporalio/worker` NativeConnection. When TEMPORAL_API_KEY is set we
 * enable TLS and route via the namespace metadata header (Temporal Cloud).
 * Without the key we fall back to plain gRPC for the local docker-compose
 * Temporal.
 */
export function buildTemporalConnectionOptions(): {
  address: string;
  tls?: Record<string, never>;
  apiKey?: string;
  metadata?: Record<string, string>;
} {
  const base = { address: env.TEMPORAL_ADDRESS };

  if (!env.TEMPORAL_API_KEY) {
    return base;
  }

  return {
    ...base,
    tls: {},
    apiKey: env.TEMPORAL_API_KEY,
    metadata: { "temporal-namespace": env.TEMPORAL_NAMESPACE },
  };
}

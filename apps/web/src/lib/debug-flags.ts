import { env } from "@shared/env/web";

const truthyFlagValues = new Set(["1", "true", "yes", "on"]);

function isTruthyDebugFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return truthyFlagValues.has(value.toLowerCase());
}

/**
 * Client-side tRPC HTTP debug logging toggle.
 */
export const isClientTrpcDebugEnabled =
  process.env.NODE_ENV === "development" || isTruthyDebugFlag(env.NEXT_PUBLIC_TRUSTLOOP_DEBUG_TRPC);

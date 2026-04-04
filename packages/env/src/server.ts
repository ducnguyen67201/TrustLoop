import { createEnv } from "@t3-oss/env-core";
import { serverSchemas } from "./shared";

/**
 * Server-side env for non-Next.js runtimes (worker, queue, shared packages).
 * Validated at import time — fails fast on missing/invalid vars.
 */
export const env = createEnv({
  server: serverSchemas,
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});

export type AppEnv = typeof env;

import { createEnv } from "@t3-oss/env-nextjs";
import { clientSchemas, serverSchemas } from "./shared";

/**
 * Next.js env — validates server + client (NEXT_PUBLIC_*) vars.
 * Client vars are inlined at build time by Next.js; runtimeEnv maps them explicitly.
 */
export const env = createEnv({
  server: serverSchemas,
  client: clientSchemas,
  runtimeEnv: {
    // Server vars — forwarded from process.env at runtime
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
    SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME,
    SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS,
    SESSION_SECRET: process.env.SESSION_SECRET,
    API_KEY_PEPPER: process.env.API_KEY_PEPPER,
    INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE,
    TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE,
    CODEX_TASK_QUEUE: process.env.CODEX_TASK_QUEUE,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_REPLAY_WINDOW_SECONDS: process.env.SLACK_REPLAY_WINDOW_SECONDS,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    SENTRY_BASE_URL: process.env.SENTRY_BASE_URL,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    TRUSTLOOP_DEBUG_TRPC: process.env.TRUSTLOOP_DEBUG_TRPC,
    // Client vars — inlined by Next.js bundler
    NEXT_PUBLIC_TRUSTLOOP_DEBUG_TRPC: process.env.NEXT_PUBLIC_TRUSTLOOP_DEBUG_TRPC,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});

export type WebEnv = typeof env;

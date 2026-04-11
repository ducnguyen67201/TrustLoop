import { z } from "zod";

export const NODE_ENV = {
  DEVELOPMENT: "development",
  TEST: "test",
  PRODUCTION: "production",
} as const;

/**
 * Shared server-side env schemas. Used by both the core (worker/queue)
 * and Next.js (web) env configurations.
 */
export const serverSchemas = {
  NODE_ENV: z.enum([NODE_ENV.DEVELOPMENT, NODE_ENV.TEST, NODE_ENV.PRODUCTION]),
  APP_BASE_URL: z.url(),
  APP_PUBLIC_URL: z.url().optional(),

  // Session
  SESSION_COOKIE_NAME: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().positive(),
  SESSION_SECRET: z.string().min(16),

  // Security
  API_KEY_PEPPER: z.string().min(16),
  INTERNAL_SERVICE_KEY: z.string().startsWith("tli_").min(20),

  // Database
  DATABASE_URL: z.string().min(1),

  // Temporal
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  TEMPORAL_TASK_QUEUE: z.string().min(1),
  CODEX_TASK_QUEUE: z.string().min(1),

  // Support / Slack
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(16).optional(),
  SLACK_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().optional().default(300),
  SLACK_BOT_TOKEN: z.string().min(1).optional(),

  // AI Analysis (Agent Service)
  OPENAI_API_KEY: z.string().min(1).optional(),
  AGENT_SERVICE_URL: z.string().url().optional(),

  // Sentry (AI Analysis context)
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
  SENTRY_BASE_URL: z.string().url().optional(),

  // Codex / GitHub App
  GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),

  // Debug
  TRUSTLOOP_DEBUG_TRPC: z.enum(["0", "1"]).optional().default("0"),
};

/** Client-side env schemas (NEXT_PUBLIC_* — inlined by Next.js at build time). */
export const clientSchemas = {
  NEXT_PUBLIC_TRUSTLOOP_DEBUG_TRPC: z.enum(["0", "1"]).optional().default("0"),
};

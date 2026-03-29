import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("trustloop_session"),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 7),
  SESSION_SECRET: z.string().min(16).default("dev-only-trustloop-session-secret"),
  API_KEY_PEPPER: z.string().min(16).default("dev-only-trustloop-api-key-pepper"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/trustloop?schema=public"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("support-general"),
  CODEX_TASK_QUEUE: z.string().default("codex-intensive"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
export type AppEnv = typeof env;

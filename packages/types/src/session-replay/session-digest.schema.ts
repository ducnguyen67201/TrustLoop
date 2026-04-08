import { z } from "zod";

// ── Session Action (condensed event for AI consumption) ────────────

export const sessionActionSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  description: z.string(),
});

// ── Session Error (aggregated error for AI consumption) ────────────

export const sessionErrorSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  message: z.string(),
  stack: z.string().nullable(),
  count: z.number().int().positive(),
});

// ── Network Failure ────────────────────────────────────────────────

export const networkFailureSchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
  timestamp: z.string(),
});

// ── Console Entry ──────────────────────────────────────────────────

export const consoleEntrySchema = z.object({
  level: z.string(),
  message: z.string(),
  timestamp: z.string(),
  count: z.number().int().positive(),
});

// ── Failure Point ──────────────────────────────────────────────────

export const failurePointSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  description: z.string(),
  precedingActions: z.array(sessionActionSchema),
});

// ── Environment ────────────────────────────────────────────────────

export const sessionEnvironmentSchema = z.object({
  url: z.string(),
  userAgent: z.string(),
  viewport: z.string(),
  release: z.string().nullable(),
});

// ── Session Digest (what the AI agent receives) ────────────────────

export const sessionDigestSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().nullable(),
  duration: z.string(),
  pageCount: z.number().int().nonnegative(),
  routeHistory: z.array(z.string()),
  lastActions: z.array(sessionActionSchema),
  errors: z.array(sessionErrorSchema),
  failurePoint: failurePointSchema.nullable(),
  networkFailures: z.array(networkFailureSchema),
  consoleErrors: z.array(consoleEntrySchema),
  environment: sessionEnvironmentSchema,
});

// ── Inferred Types ─────────────────────────────────────────────────

export type SessionAction = z.infer<typeof sessionActionSchema>;
export type SessionError = z.infer<typeof sessionErrorSchema>;
export type NetworkFailure = z.infer<typeof networkFailureSchema>;
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;
export type FailurePoint = z.infer<typeof failurePointSchema>;
export type SessionEnvironment = z.infer<typeof sessionEnvironmentSchema>;
export type SessionDigest = z.infer<typeof sessionDigestSchema>;

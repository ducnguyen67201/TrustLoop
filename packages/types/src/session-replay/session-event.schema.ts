import { z } from "zod";

// ── Event Type Enum ────────────────────────────────────────────────

export const SESSION_EVENT_TYPE = {
  click: "CLICK",
  route: "ROUTE",
  networkError: "NETWORK_ERROR",
  consoleError: "CONSOLE_ERROR",
  exception: "EXCEPTION",
} as const;

export const sessionEventTypeValues = [
  SESSION_EVENT_TYPE.click,
  SESSION_EVENT_TYPE.route,
  SESSION_EVENT_TYPE.networkError,
  SESSION_EVENT_TYPE.consoleError,
  SESSION_EVENT_TYPE.exception,
] as const;

export const sessionEventTypeSchema = z.enum(sessionEventTypeValues);

// ── Route Navigation Method ────────────────────────────────────────

export const ROUTE_METHOD = {
  push: "PUSH",
  pop: "POP",
  replace: "REPLACE",
} as const;

export const routeMethodValues = [
  ROUTE_METHOD.push,
  ROUTE_METHOD.pop,
  ROUTE_METHOD.replace,
] as const;

export const routeMethodSchema = z.enum(routeMethodValues);

// ── Console Error Level ────────────────────────────────────────────

export const CONSOLE_LEVEL = {
  error: "ERROR",
  warn: "WARN",
} as const;

export const consoleLevelValues = [CONSOLE_LEVEL.error, CONSOLE_LEVEL.warn] as const;

export const consoleLevelSchema = z.enum(consoleLevelValues);

// ── Event Payload Schemas ──────────────────────────────────────────

export const clickPayloadSchema = z.object({
  selector: z.string(),
  tag: z.string(),
  text: z.string().max(200),
  x: z.number(),
  y: z.number(),
});

export const routePayloadSchema = z.object({
  from: z.string(),
  to: z.string(),
  method: routeMethodSchema,
});

export const networkErrorPayloadSchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
  requestId: z.string().optional(),
});

export const consoleErrorPayloadSchema = z.object({
  level: consoleLevelSchema,
  message: z.string(),
  stack: z.string().optional(),
});

export const exceptionPayloadSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  name: z.string(),
  source: z.string().optional(),
});

// ── Discriminated Union Payload ────────────────────────────────────

export const sessionEventPayloadSchema = z.discriminatedUnion("eventType", [
  z.object({ eventType: z.literal(SESSION_EVENT_TYPE.click), payload: clickPayloadSchema }),
  z.object({ eventType: z.literal(SESSION_EVENT_TYPE.route), payload: routePayloadSchema }),
  z.object({
    eventType: z.literal(SESSION_EVENT_TYPE.networkError),
    payload: networkErrorPayloadSchema,
  }),
  z.object({
    eventType: z.literal(SESSION_EVENT_TYPE.consoleError),
    payload: consoleErrorPayloadSchema,
  }),
  z.object({
    eventType: z.literal(SESSION_EVENT_TYPE.exception),
    payload: exceptionPayloadSchema,
  }),
]);

// ── Main Session Event Schema ──────────────────────────────────────

export const sessionEventSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    url: z.string().optional(),
  })
  .and(sessionEventPayloadSchema);

// ── Ingest Payload Schema (what the SDK sends to the API) ──────────

export const sessionIngestPayloadSchema = z.object({
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1).nullable().optional(),
  userEmail: z.email().nullable().optional(),
  timestamp: z.number().int().nonnegative(),
  structuredEvents: z.array(sessionEventSchema),
  rrwebEvents: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(),
});

// ── Inferred Types ─────────────────────────────────────────────────

export type SessionEventType = z.infer<typeof sessionEventTypeSchema>;
export type RouteMethod = z.infer<typeof routeMethodSchema>;
export type ConsoleLevel = z.infer<typeof consoleLevelSchema>;
export type ClickPayload = z.infer<typeof clickPayloadSchema>;
export type RoutePayload = z.infer<typeof routePayloadSchema>;
export type NetworkErrorPayload = z.infer<typeof networkErrorPayloadSchema>;
export type ConsoleErrorPayload = z.infer<typeof consoleErrorPayloadSchema>;
export type ExceptionPayload = z.infer<typeof exceptionPayloadSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type SessionIngestPayload = z.infer<typeof sessionIngestPayloadSchema>;

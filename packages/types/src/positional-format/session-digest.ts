import { z } from "zod";

/**
 * Positional JSON format for session digest LLM output compression.
 *
 * Reduces output tokens by ~70-80% using short field names and numeric codes.
 * Used when the AI agent summarizes a session replay into a digest for analysis.
 *
 * COMPRESSED -> EXPANDED mapping:
 *
 *   { "s", "u", "d", "p", "r", "l", "e", "f", "n", "c", "v" }
 *       |
 *   { "sessionId", "userId", "duration", "pageCount", "routeHistory",
 *     "lastActions", "errors", "failurePoint", "networkFailures",
 *     "consoleErrors", "environment" }
 */

// ── Code Mappings ───────────────────────────────────────────────────

export const SESSION_ERROR_TYPE_CODES = ["EXCEPTION", "NETWORK_ERROR", "CONSOLE_ERROR"] as const;

export const SESSION_ACTION_TYPE_CODES = [
  "CLICK",
  "ROUTE",
  "NETWORK_ERROR",
  "CONSOLE_ERROR",
  "EXCEPTION",
] as const;

// ── Compressed Schema (what the LLM returns) ────────────────────────

// Action: "timestamp|type_code|description"
const compressedActionSchema = z.string();

// Error: "timestamp|type_code|message|count" (stack omitted in compressed form)
const compressedErrorSchema = z.string();

// Network failure: "method url|status|durationMs|timestamp"
const compressedNetworkFailureSchema = z.string();

// Console entry: "level|message|timestamp|count"
const compressedConsoleEntrySchema = z.string();

const compressedFailurePointSchema = z.object({
  t: z.string(),
  y: z.number().int().min(0).max(2),
  d: z.string(),
  p: z.array(compressedActionSchema),
});

const compressedEnvironmentSchema = z.object({
  u: z.string(),
  a: z.string(),
  w: z.string(),
  r: z.string().nullable(),
});

export const compressedSessionDigestSchema = z.object({
  s: z.string(),
  u: z.string().nullable(),
  d: z.string(),
  p: z.number().int(),
  r: z.array(z.string()),
  l: z.array(compressedActionSchema),
  e: z.array(compressedErrorSchema),
  f: compressedFailurePointSchema.nullable(),
  n: z.array(compressedNetworkFailureSchema),
  c: z.array(compressedConsoleEntrySchema),
  v: compressedEnvironmentSchema,
});

export type CompressedSessionDigest = z.infer<typeof compressedSessionDigestSchema>;

// ── Reconstruction (compressed -> full schema) ──────────────────────

type SessionErrorType = (typeof SESSION_ERROR_TYPE_CODES)[number];
type SessionActionType = (typeof SESSION_ACTION_TYPE_CODES)[number];

type ReconstructedAction = {
  timestamp: string;
  type: string;
  description: string;
};

type ReconstructedError = {
  timestamp: string;
  type: string;
  message: string;
  stack: null;
  count: number;
};

type ReconstructedNetworkFailure = {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  timestamp: string;
};

type ReconstructedConsoleEntry = {
  level: string;
  message: string;
  timestamp: string;
  count: number;
};

export type ReconstructedSessionDigest = {
  sessionId: string;
  userId: string | null;
  duration: string;
  pageCount: number;
  routeHistory: string[];
  lastActions: ReconstructedAction[];
  errors: ReconstructedError[];
  failurePoint: {
    timestamp: string;
    type: string;
    description: string;
    precedingActions: ReconstructedAction[];
  } | null;
  networkFailures: ReconstructedNetworkFailure[];
  consoleErrors: ReconstructedConsoleEntry[];
  environment: {
    url: string;
    userAgent: string;
    viewport: string;
    release: string | null;
  };
};

function parseAction(raw: string): ReconstructedAction {
  const parts = raw.split("|");
  const timestamp = parts[0] ?? "";
  const typeCode = Number(parts[1] ?? 0);
  const description = parts.slice(2).join("|");
  const type: SessionActionType = SESSION_ACTION_TYPE_CODES[typeCode] ?? "CLICK";
  return { timestamp, type, description };
}

function parseError(raw: string): ReconstructedError {
  const parts = raw.split("|");
  const timestamp = parts[0] ?? "";
  const typeCode = Number(parts[1] ?? 0);
  const message = parts[2] ?? "";
  const count = Number(parts[3] ?? 1);
  const type: SessionErrorType = SESSION_ERROR_TYPE_CODES[typeCode] ?? "EXCEPTION";
  return { timestamp, type, message, stack: null, count };
}

function parseNetworkFailure(raw: string): ReconstructedNetworkFailure {
  const parts = raw.split("|");
  const methodUrl = (parts[0] ?? "").split(" ");
  const method = methodUrl[0] ?? "GET";
  const url = methodUrl.slice(1).join(" ");
  const status = Number(parts[1] ?? 0);
  const durationMs = Number(parts[2] ?? 0);
  const timestamp = parts[3] ?? "";
  return { method, url, status, durationMs, timestamp };
}

function parseConsoleEntry(raw: string): ReconstructedConsoleEntry {
  const parts = raw.split("|");
  const level = parts[0] ?? "ERROR";
  const message = parts[1] ?? "";
  const timestamp = parts[2] ?? "";
  const count = Number(parts[3] ?? 1);
  return { level, message, timestamp, count };
}

export function reconstructSessionDigest(
  compressed: CompressedSessionDigest
): ReconstructedSessionDigest {
  return {
    sessionId: compressed.s,
    userId: compressed.u,
    duration: compressed.d,
    pageCount: compressed.p,
    routeHistory: compressed.r,
    lastActions: compressed.l.map(parseAction),
    errors: compressed.e.map(parseError),
    failurePoint: compressed.f
      ? {
          timestamp: compressed.f.t,
          type: SESSION_ERROR_TYPE_CODES[compressed.f.y] ?? "EXCEPTION",
          description: compressed.f.d,
          precedingActions: compressed.f.p.map(parseAction),
        }
      : null,
    networkFailures: compressed.n.map(parseNetworkFailure),
    consoleErrors: compressed.c.map(parseConsoleEntry),
    environment: {
      url: compressed.v.u,
      userAgent: compressed.v.a,
      viewport: compressed.v.w,
      release: compressed.v.r,
    },
  };
}

// ── Prompt Instructions ─────────────────────────────────────────────

export const POSITIONAL_SESSION_DIGEST_FORMAT_INSTRUCTIONS = `
Field reference:
  s = sessionId
  u = userId (null if anonymous)
  d = duration (human readable, e.g. "3m 42s")
  p = page count
  r = route history array (URL paths)
  l = last actions array, each as flat string: "timestamp|type_code|description"
      type codes: 0=CLICK, 1=ROUTE, 2=NETWORK_ERROR, 3=CONSOLE_ERROR, 4=EXCEPTION
  e = errors array, each as flat string: "timestamp|type_code|message|count"
      type codes: 0=EXCEPTION, 1=NETWORK_ERROR, 2=CONSOLE_ERROR
  f = failure point (null if no clear failure)
    t = timestamp
    y = type code (same as error type codes: 0=EXCEPTION, 1=NETWORK_ERROR, 2=CONSOLE_ERROR)
    d = description
    p = preceding actions array (same format as l, 5 events before failure)
  n = network failures array, each as flat string: "method url|status|durationMs|timestamp"
  c = console errors array, each as flat string: "level|message|timestamp|count"
  v = environment
    u = url
    a = userAgent
    w = viewport (e.g. "1920x1080")
    r = release (null if unknown)

Example with failure point:
{"s":"sess_abc123","u":"user_42","d":"3m 42s","p":4,"r":["/","/settings","/settings/billing","/settings/billing/upgrade"],"l":["12:00:01|1|/settings","12:00:05|0|Clicked billing tab","12:00:08|1|/settings/billing","12:00:12|0|Clicked upgrade button","12:00:13|2|POST /api/checkout failed 500"],"e":["12:00:13|1|POST /api/checkout 500|1"],"f":{"t":"12:00:13","y":1,"d":"Checkout API returned 500 after clicking upgrade","p":["12:00:01|1|/settings","12:00:05|0|Clicked billing tab","12:00:08|1|/settings/billing","12:00:12|0|Clicked upgrade button","12:00:13|2|POST /api/checkout failed 500"]},"n":["POST /api/checkout|500|1200|12:00:13"],"c":[],"v":{"u":"https://app.example.com/settings/billing/upgrade","a":"Mozilla/5.0 Chrome/120","w":"1920x1080","r":"v2.3.1"}}

Example without failure point (browsing session):
{"s":"sess_xyz789","u":null,"d":"1m 15s","p":2,"r":["/","/docs"],"l":["12:00:01|1|/","12:00:10|0|Clicked docs link","12:00:11|1|/docs"],"e":[],"f":null,"n":[],"c":[],"v":{"u":"https://app.example.com/docs","a":"Mozilla/5.0 Safari/17","w":"1440x900","r":null}}`;

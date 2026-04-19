import {
  sessionBriefSchema,
  sessionConversationMatchSchema,
} from "@shared/types/session-replay/session-match.schema";
import { sessionMatchConfidenceSchema } from "@shared/types/session-replay/session-replay.schema";
import { z } from "zod";

// ── Session Timeline Event (API response shape) ──────────────────

export const sessionTimelineEventSchema = z.object({
  id: z.string().min(1),
  eventType: z.string(),
  timestamp: z.string(),
  url: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

// ── Replay Chunk Response (subset returned by API) ───────────────

export const replayChunkResponseSchema = z.object({
  sequenceNumber: z.number().int(),
  compressedData: z.string(), // base64-encoded binary data for JSON-safe transport
  startTimestamp: z.string(),
  endTimestamp: z.string(),
});

// ── Session Record Response (subset returned by correlate/get) ───

export const sessionRecordResponseSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  userEmail: z.string().nullable(),
  userId: z.string().nullable(),
  userAgent: z.string().nullable(),
  startedAt: z.string(),
  lastEventAt: z.string(),
  eventCount: z.number().int(),
  hasReplayData: z.boolean(),
});

// ── Correlate Result ─────────────────────────────────────────────

export const sessionCorrelateResultSchema = z.object({
  session: sessionRecordResponseSchema.nullable(),
  matchConfidence: sessionMatchConfidenceSchema,
});

export const sessionForConversationResponseSchema = z.object({
  match: sessionConversationMatchSchema.nullable(),
  session: sessionRecordResponseSchema.nullable(),
  sessionBrief: sessionBriefSchema.nullable(),
  events: z.array(sessionTimelineEventSchema),
  failurePointId: z.string().min(1).nullable(),
});

// ── Inferred Types ───────────────────────────────────────────────

export type SessionTimelineEvent = z.infer<typeof sessionTimelineEventSchema>;
export type ReplayChunkResponse = z.infer<typeof replayChunkResponseSchema>;
export type SessionRecordResponse = z.infer<typeof sessionRecordResponseSchema>;
export type SessionCorrelateResult = z.infer<typeof sessionCorrelateResultSchema>;
export type SessionForConversationResponse = z.infer<typeof sessionForConversationResponseSchema>;

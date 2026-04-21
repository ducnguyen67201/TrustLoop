import { z } from "zod";

// ── Session Record Status ──────────────────────────────────────────

export const SESSION_RECORD_STATUS = {
  recording: "RECORDING",
  processing: "PROCESSING",
  ready: "READY",
  failed: "FAILED",
} as const;

export const sessionRecordStatusValues = [
  SESSION_RECORD_STATUS.recording,
  SESSION_RECORD_STATUS.processing,
  SESSION_RECORD_STATUS.ready,
  SESSION_RECORD_STATUS.failed,
] as const;

export const sessionRecordStatusSchema = z.enum(sessionRecordStatusValues);

// ── Session Record (matches future Prisma model) ───────────────────

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().min(1).nullable(),
  userEmail: z.email().nullable(),
  status: sessionRecordStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  eventCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  userAgent: z.string().nullable(),
  viewport: z.string().nullable(),
  entryUrl: z.string().nullable(),
  release: z.string().nullable(),
  conversationId: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// ── Chunk Type ─────────────────────────────────────────────────────

export const SESSION_CHUNK_TYPE = {
  structured: "STRUCTURED",
  rrweb: "RRWEB",
} as const;

export const sessionChunkTypeValues = [
  SESSION_CHUNK_TYPE.structured,
  SESSION_CHUNK_TYPE.rrweb,
] as const;

export const sessionChunkTypeSchema = z.enum(sessionChunkTypeValues);

// ── Session Replay Chunk (matches future Prisma model) ─────────────

export const sessionReplayChunkSchema = z.object({
  id: z.string().min(1),
  sessionRecordId: z.string().min(1),
  chunkType: sessionChunkTypeSchema,
  sequenceNumber: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  startTimestamp: z.number().int().nonnegative(),
  endTimestamp: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
  createdAt: z.iso.datetime(),
});

// ── Session Match Confidence ──────────────────────────────────────

export const SESSION_MATCH_CONFIDENCE = {
  confirmed: "confirmed",
  fuzzy: "fuzzy",
  none: "none",
} as const;

export const sessionMatchConfidenceValues = [
  SESSION_MATCH_CONFIDENCE.confirmed,
  SESSION_MATCH_CONFIDENCE.fuzzy,
  SESSION_MATCH_CONFIDENCE.none,
] as const;

export const sessionMatchConfidenceSchema = z.enum(sessionMatchConfidenceValues);

export type SessionMatchConfidence = z.infer<typeof sessionMatchConfidenceSchema>;

// ── Inferred Types ─────────────────────────────────────────────────

export type SessionRecordStatus = z.infer<typeof sessionRecordStatusSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type SessionChunkType = z.infer<typeof sessionChunkTypeSchema>;
export type SessionReplayChunk = z.infer<typeof sessionReplayChunkSchema>;

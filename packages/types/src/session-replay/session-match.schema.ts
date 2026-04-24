import { sessionMatchConfidenceSchema } from "@shared/types/session-replay/session-replay.schema";
import { z } from "zod";

export const SESSION_REPLAY_MATCH_SOURCE = {
  userId: "user_id",
  conversationEmail: "conversation_email",
  slackProfileEmail: "slack_profile_email",
  messageRegexEmail: "message_regex_email",
  manual: "manual",
} as const;

export const sessionReplayMatchSourceValues = [
  SESSION_REPLAY_MATCH_SOURCE.userId,
  SESSION_REPLAY_MATCH_SOURCE.conversationEmail,
  SESSION_REPLAY_MATCH_SOURCE.slackProfileEmail,
  SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail,
  SESSION_REPLAY_MATCH_SOURCE.manual,
] as const;

export const sessionReplayMatchSourceSchema = z.enum(sessionReplayMatchSourceValues);

export const SESSION_MATCHED_IDENTIFIER_TYPE = {
  userId: "user_id",
  email: "email",
  sessionId: "session_id",
} as const;

export const sessionMatchedIdentifierTypeValues = [
  SESSION_MATCHED_IDENTIFIER_TYPE.userId,
  SESSION_MATCHED_IDENTIFIER_TYPE.email,
  SESSION_MATCHED_IDENTIFIER_TYPE.sessionId,
] as const;

export const sessionMatchedIdentifierTypeSchema = z.enum(sessionMatchedIdentifierTypeValues);

export const sessionConversationMatchSchema = z.object({
  conversationId: z.string().min(1),
  sessionRecordId: z.string().min(1),
  matchSource: sessionReplayMatchSourceSchema,
  matchConfidence: sessionMatchConfidenceSchema,
  matchedIdentifierType: sessionMatchedIdentifierTypeSchema,
  matchedIdentifierValue: z.string().min(1),
  score: z.number().int(),
  isPrimary: z.boolean(),
  evidenceJson: z.record(z.string(), z.unknown()).nullable(),
});

export const sessionBriefSchema = z.object({
  headline: z.string().trim().min(1),
  bullets: z.array(z.string().trim().min(1)).max(3),
});

export type SessionReplayMatchSource = z.infer<typeof sessionReplayMatchSourceSchema>;
export type SessionMatchedIdentifierType = z.infer<typeof sessionMatchedIdentifierTypeSchema>;
export type SessionConversationMatch = z.infer<typeof sessionConversationMatchSchema>;
export type SessionBrief = z.infer<typeof sessionBriefSchema>;

import { z } from "zod";

// Single source of truth for the source-type enum, mirroring the Postgres
// `KnowledgeChunkSource` enum in packages/database/prisma/schema/workspace-knowledge.prisma.
// Use the const enum object — never inline the string literals.

export const KNOWLEDGE_CHUNK_SOURCE = {
  CODE: "CODE",
  MANUAL_NOTE: "MANUAL_NOTE",
  PAST_RESOLUTION: "PAST_RESOLUTION",
} as const;

export const knowledgeChunkSourceSchema = z.enum([
  KNOWLEDGE_CHUNK_SOURCE.CODE,
  KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
  KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
]);

export type KnowledgeChunkSource = z.infer<typeof knowledgeChunkSourceSchema>;

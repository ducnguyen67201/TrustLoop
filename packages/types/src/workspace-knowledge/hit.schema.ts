import {
  KNOWLEDGE_CHUNK_SOURCE,
  knowledgeChunkSourceSchema,
} from "@shared/types/workspace-knowledge/source.schema";
import { z } from "zod";

// KnowledgeHit — uniform retrieval contract returned by every per-source
// searcher. The metadata is a discriminated union, keyed by `source`, so
// callers get type-safe access to source-specific fields without a junk-drawer
// `Record<string, unknown>`. (Closes the codex outside-voice "metadata becomes
// junk drawer" finding.)

export const codeKnowledgeMetadataSchema = z.object({
  source: z.literal(KNOWLEDGE_CHUNK_SOURCE.CODE),
  filePath: z.string(),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  repositoryId: z.string(),
  language: z.string().nullable(),
});

export const manualNoteMetadataSchema = z.object({
  source: z.literal(KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE),
  noteId: z.string(),
  title: z.string(),
});

export const pastResolutionMetadataSchema = z.object({
  source: z.literal(KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION),
  conversationId: z.string(),
  sourceEventId: z.string(),
  approvedAt: z.iso.datetime(),
});

export const knowledgeHitMetadataSchema = z.discriminatedUnion("source", [
  codeKnowledgeMetadataSchema,
  manualNoteMetadataSchema,
  pastResolutionMetadataSchema,
]);

export const knowledgeHitSchema = z.object({
  id: z.string(),
  source: knowledgeChunkSourceSchema,
  content: z.string(),
  /// Raw or reranked score — caller does not depend on this being normalized
  /// across sources (see plan, D8 cross-source merge).
  score: z.number(),
  metadata: knowledgeHitMetadataSchema,
});

export type CodeKnowledgeMetadata = z.infer<typeof codeKnowledgeMetadataSchema>;
export type ManualNoteMetadata = z.infer<typeof manualNoteMetadataSchema>;
export type PastResolutionMetadata = z.infer<typeof pastResolutionMetadataSchema>;
export type KnowledgeHitMetadata = z.infer<typeof knowledgeHitMetadataSchema>;
export type KnowledgeHit = z.infer<typeof knowledgeHitSchema>;

// Searcher contract — every per-source searcher exports a function with this
// shape. Adding a new source (Notion, Drive) = a new file + new searcher
// + register in the umbrella.
export type KnowledgeSearcher = (
  workspaceId: string,
  query: string,
  k: number
) => Promise<KnowledgeHit[]>;

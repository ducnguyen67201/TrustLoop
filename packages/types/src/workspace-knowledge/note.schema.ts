import { z } from "zod";

// Manual-note CRUD payload contracts. Operator pastes a markdown chunk + title
// via Settings UI; embedded inline on create.

const TITLE_MIN = 3;
const TITLE_MAX = 200;
const CONTENT_MIN = 20;
const CONTENT_MAX = 16_000;

export const createKnowledgeNoteInputSchema = z.object({
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  content: z.string().trim().min(CONTENT_MIN).max(CONTENT_MAX),
});

export const deleteKnowledgeNoteInputSchema = z.object({
  noteId: z.string().min(1),
});

export const knowledgeNoteRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  contentPreview: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdByUserId: z.string().nullable(),
});

export const listKnowledgeNotesOutputSchema = z.object({
  notes: z.array(knowledgeNoteRowSchema),
  totalCount: z.number().int().nonnegative(),
});

export type CreateKnowledgeNoteInput = z.infer<typeof createKnowledgeNoteInputSchema>;
export type DeleteKnowledgeNoteInput = z.infer<typeof deleteKnowledgeNoteInputSchema>;
export type KnowledgeNoteRow = z.infer<typeof knowledgeNoteRowSchema>;
export type ListKnowledgeNotesOutput = z.infer<typeof listKnowledgeNotesOutputSchema>;

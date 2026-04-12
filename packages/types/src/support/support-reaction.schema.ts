import { z } from "zod";

export const supportReactionSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  emojiName: z.string().min(1),
  emojiUnicode: z.string().nullable(),
  actorUserId: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const supportToggleReactionInputSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  eventId: z.string().min(1),
  emojiName: z.string().min(1),
  emojiUnicode: z.string().nullable().default(null),
  actorUserId: z.string().min(1),
});

export type SupportReaction = z.infer<typeof supportReactionSchema>;
export type SupportToggleReactionInput = z.infer<typeof supportToggleReactionInputSchema>;

import { prisma } from "@shared/database";
import { type SupportCommandResponse, supportCommandResponseSchema } from "@shared/types";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// supportCommand/_shared — helpers used across multiple command files
//
// Only put something here if more than one command file needs it. Single-file
// helpers stay private to that file. See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

/**
 * Load a SupportConversation scoped to the workspace or throw NOT_FOUND.
 * Used by every command that needs to verify the target exists before
 * mutating state.
 */
export async function requireConversation(workspaceId: string, conversationId: string) {
  const conversation = await prisma.supportConversation.findFirst({
    where: {
      id: conversationId,
      workspaceId,
    },
  });

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Support conversation not found",
    });
  }

  return conversation;
}

/**
 * Build the canonical accepted-command response envelope. All commands return
 * the same shape: `{ accepted: true, commandId, workflowId: null }`.
 */
export function buildCommandResponse(commandId: string): SupportCommandResponse {
  return supportCommandResponseSchema.parse({
    accepted: true,
    commandId,
    workflowId: null,
  });
}

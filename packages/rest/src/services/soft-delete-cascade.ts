import type { prisma } from "@shared/database";

/**
 * Transaction client type derived from the extended prisma client.
 * Using Parameters<> to match the actual tx type from $transaction callbacks.
 */
type Tx = Parameters<Parameters<(typeof prisma)["$transaction"]>[0]>[0];

/**
 * Cascade soft delete all Tier 1 children of a workspace.
 * Also hard-deletes sessions (Tier 2) for the workspace.
 */
export async function cascadeSoftDeleteWorkspace(workspaceId: string, tx: Tx) {
  const now = new Date();

  await Promise.all([
    tx.supportTicketLink.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.supportDeliveryAttempt.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.supportConversation.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.supportInstallation.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.workspaceApiKey.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.workspaceMembership.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
  ]);
}

/**
 * Cascade soft delete an installation's conversations and their children.
 */
export async function cascadeSoftDeleteInstallation(
  installationId: string,
  workspaceId: string,
  tx: Tx
) {
  const now = new Date();

  const conversations = await tx.supportConversation.findMany({
    where: { installationId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  await Promise.all([
    tx.supportConversation.updateMany({
      where: { installationId, workspaceId, deletedAt: null },
      data: { deletedAt: now },
    }),
    ...(conversationIds.length > 0
      ? [
          tx.supportDeliveryAttempt.updateMany({
            where: { conversationId: { in: conversationIds }, deletedAt: null },
            data: { deletedAt: now },
          }),
          tx.supportTicketLink.updateMany({
            where: { conversationId: { in: conversationIds }, deletedAt: null },
            data: { deletedAt: now },
          }),
        ]
      : []),
  ]);
}

/**
 * Cascade soft delete a conversation's delivery attempts and ticket links.
 */
export async function cascadeSoftDeleteConversation(conversationId: string, tx: Tx) {
  const now = new Date();

  await Promise.all([
    tx.supportDeliveryAttempt.updateMany({
      where: { conversationId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.supportTicketLink.updateMany({
      where: { conversationId, deletedAt: null },
      data: { deletedAt: now },
    }),
  ]);
}

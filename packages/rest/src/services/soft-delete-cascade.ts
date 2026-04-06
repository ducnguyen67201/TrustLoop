// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;

type WritableDelegate = { updateMany: DelegateFn };
type DeletableDelegate = { deleteMany: DelegateFn };
type ReadableDelegate = { findMany: DelegateFn };

export interface CascadeTx {
  supportTicketLink: WritableDelegate;
  supportDeliveryAttempt: WritableDelegate;
  supportConversation: WritableDelegate & ReadableDelegate;
  supportInstallation: WritableDelegate;
  workspaceApiKey: WritableDelegate;
  workspaceMembership: WritableDelegate;
  user: WritableDelegate;
  session: DeletableDelegate;
}

/**
 * Cascade soft delete all Tier 1 children of a workspace.
 */
export async function cascadeSoftDeleteWorkspace(workspaceId: string, tx: CascadeTx) {
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
  tx: CascadeTx
) {
  const now = new Date();

  const conversations: Array<{ id: string }> = await tx.supportConversation.findMany({
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
 * Deactivate a user: soft-delete the user record and hard-delete their sessions.
 */
export async function cascadeDeactivateUser(userId: string, tx: CascadeTx) {
  const now = new Date();

  await Promise.all([
    tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { deletedAt: now },
    }),
    tx.session.deleteMany({
      where: { userId },
    }),
    tx.workspaceMembership.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: now },
    }),
  ]);
}

/**
 * Cascade soft delete a conversation's delivery attempts and ticket links.
 */
export async function cascadeSoftDeleteConversation(conversationId: string, tx: CascadeTx) {
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

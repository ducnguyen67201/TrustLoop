import { prismaRaw } from "./index";

/**
 * Permanently delete records soft-deleted more than `retentionDays` ago.
 * Uses the raw (non-extended) client so deleteMany performs actual SQL DELETE.
 * Deletes in dependency order (children first) to respect onDelete: Restrict.
 *
 * Tier 3 models (SupportConversationEvent, SupportDeadLetter, SupportIngressEvent)
 * keep onDelete: Cascade on their parent FKs, so they are automatically removed
 * when their parent rows are hard-deleted here.
 */
export async function purgeDeletedRecords(retentionDays = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const where = { deletedAt: { lt: cutoff } };

  // Children first, parents last — respects onDelete: Restrict
  await prismaRaw.$transaction([
    prismaRaw.supportTicketLink.deleteMany({ where }),
    prismaRaw.supportDeliveryAttempt.deleteMany({ where }),
    // SupportConversationEvent → SupportConversation uses onDelete: Cascade,
    // so conversation events are auto-removed when conversations are deleted below.
    prismaRaw.supportConversation.deleteMany({ where }),
    // SupportIngressEvent → SupportInstallation uses onDelete: Cascade,
    // so ingress events are auto-removed when installations are deleted below.
    prismaRaw.supportInstallation.deleteMany({ where }),
    prismaRaw.workspaceApiKey.deleteMany({ where }),
    prismaRaw.workspaceMembership.deleteMany({ where }),
    // Session → User uses onDelete: Cascade, so sessions are auto-removed with users.
    prismaRaw.user.deleteMany({ where }),
    // Remaining workspace children (AuditLog, SupportDeadLetter, Codex models)
    // use onDelete: Cascade/SetNull, so they are cleaned up when workspace is deleted.
    prismaRaw.workspace.deleteMany({ where }),
  ]);
}

import { prisma } from "@shared/database";
import type { Prisma } from "@shared/database";

interface AuditEvent {
  action: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Persist a structured security/admin audit event.
 */
export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: event.action,
      workspaceId: event.workspaceId ?? null,
      actorUserId: event.actorUserId ?? null,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      metadata: event.metadata ?? undefined,
    },
  });
}

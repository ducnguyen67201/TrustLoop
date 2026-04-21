import { prisma } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import {
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_GROUPING_CORRECTION_KIND,
  SUPPORT_REALTIME_REASON,
  type SupportGroupingCorrectionKind,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// support-grouping-correction service
//
// Operator-facing grouping corrections: merge two or more conversations into
// one, reassign a single event to a different conversation, and undo either
// within a 24h window. Every correction writes a SupportGroupingCorrection
// row (the audit + training corpus), a SupportConversationEvent on each
// affected conversation (the user-visible timeline), and an auditLog entry
// (the security/admin stream).
//
// Namespace import:
//   import * as groupingCorrection from "@shared/rest/services/support/support-grouping-correction-service";
//
// Plan: docs/plans/impl-plan-thread-merge-split-reassign.md §6.
//
// Discipline:
// - Soft-deletes ALWAYS go through `updateMany({ data: { deletedAt: ... } })`
//   because CLAUDE.md "Soft Delete Rules" forbids `.delete()` inside
//   `$transaction()`. The extension converts-to-update using the base client,
//   which escapes the transaction boundary.
// - Merge uses a two-phase commit: alias rows are written in their OWN
//   $transaction and committed BEFORE the main merge transaction runs. This
//   closes the ingress race (F3 in the plan): a Slack webhook arriving for
//   the secondary's threadTs during the merge still finds the alias and
//   routes to the primary.
// - Idempotency via (workspaceId, idempotencyKey) unique. On unique-violation
//   the service returns the existing correction id instead of throwing.
// - Undo collision detection is a formal dependency check: correction X
//   depends on Y if X.createdAt > Y.createdAt AND X's involved-set intersects
//   Y's. An active dependent blocks undo.
// ---------------------------------------------------------------------------

export interface MergeInput {
  workspaceId: string;
  actorUserId: string;
  primaryConversationId: string;
  secondaryConversationIds: string[];
  idempotencyKey: string;
}

export interface MergeResult {
  correctionId: string;
  primaryConversationId: string;
  mergedSecondaryIds: string[];
}

export interface ReassignEventInput {
  workspaceId: string;
  actorUserId: string;
  eventId: string;
  targetConversationId: string;
  idempotencyKey: string;
}

export interface ReassignEventResult {
  correctionId: string;
  eventId: string;
}

export interface UndoCorrectionInput {
  workspaceId: string;
  actorUserId: string;
  correctionId: string;
}

export interface UndoCorrectionResult {
  correctionId: string;
  kind: SupportGroupingCorrectionKind;
}

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

// Prisma's unique-violation error code on conflicting insert. Detected by
// duck-typing on `.code` rather than `instanceof Prisma.PrismaClientKnownRequestError`
// because @shared/database exports Prisma as a type-only re-export under
// `verbatimModuleSyntax`.
const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * Merge one or more secondary conversations INTO a primary conversation.
 *
 * Order of operations (plan §6.1):
 *   Phase 1 (own tx, committed first):
 *     Upsert thread-alias rows so Slack webhooks racing the merge route
 *     to the primary even if they arrive mid-phase-2.
 *
 *   Phase 2 (main merge tx):
 *     - Assert same workspace + same channel on all involved conversations.
 *     - Soft-delete secondaries via updateMany (NOT .delete — CLAUDE.md).
 *     - Emit MERGED events on primary and each secondary.
 *     - Insert one SupportGroupingCorrection row scoped by idempotencyKey.
 *
 *   After commit:
 *     - Audit event.
 *     - Realtime emit on primary + each secondary.
 *
 * On idempotency-key replay, returns the existing correction without writes.
 */
export async function merge(input: MergeInput): Promise<MergeResult> {
  if (input.secondaryConversationIds.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No secondary conversations provided" });
  }

  if (input.secondaryConversationIds.includes(input.primaryConversationId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Primary conversation cannot also be a secondary",
    });
  }

  // Idempotency fast-path: if a correction with this key already exists,
  // return it without doing any writes. The unique index would catch a
  // double-insert in phase 2 anyway, but skipping phase 1 avoids pointless
  // alias churn on retry.
  const existing = await prisma.supportGroupingCorrection.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, sourceConversationId: true, targetConversationId: true },
  });
  if (existing) {
    return {
      correctionId: existing.id,
      primaryConversationId: existing.targetConversationId ?? input.primaryConversationId,
      mergedSecondaryIds: input.secondaryConversationIds,
    };
  }

  // Pre-flight invariant checks — cheaper to fail fast here than inside the
  // alias-write tx.
  const allIds = [input.primaryConversationId, ...input.secondaryConversationIds];
  const conversations = await prisma.supportConversation.findMany({
    where: { id: { in: allIds }, workspaceId: input.workspaceId },
    select: {
      id: true,
      installationId: true,
      channelId: true,
      threadTs: true,
      deletedAt: true,
    },
  });

  if (conversations.length !== allIds.length) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One or more conversations not found in this workspace",
    });
  }

  const primary = conversations.find((c) => c.id === input.primaryConversationId);
  if (!primary) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Primary conversation not found" });
  }
  if (primary.deletedAt) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Primary conversation is archived; pick a different primary",
    });
  }

  const secondaries = conversations.filter((c) => c.id !== input.primaryConversationId);
  for (const s of secondaries) {
    if (s.deletedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Conversation ${s.id} is already archived`,
      });
    }
    if (s.channelId !== primary.channelId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Can't merge — conversations are in different channels. Move one first.",
      });
    }
    if (s.installationId !== primary.installationId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Conversations belong to different Slack installations",
      });
    }
  }

  // Phase 1: upsert alias rows. Own tx, committed before phase 2 so an
  // ingress event arriving between phases still finds the alias.
  await prisma.$transaction(async (tx) => {
    for (const s of secondaries) {
      await tx.supportConversationThreadAlias.upsert({
        where: {
          installationId_channelId_threadTs: {
            installationId: s.installationId,
            channelId: s.channelId,
            threadTs: s.threadTs,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          installationId: s.installationId,
          channelId: s.channelId,
          threadTs: s.threadTs,
          conversationId: input.primaryConversationId,
        },
        update: {
          conversationId: input.primaryConversationId,
        },
      });
    }
  });

  // Phase 2: main merge tx. Soft-delete secondaries, write events + correction.
  const correctionId = await prisma
    .$transaction(async (tx) => {
      const now = new Date();
      const secondaryIds = secondaries.map((s) => s.id);

      // Soft-delete via updateMany — NEVER .delete() inside $transaction
      // on soft-delete models.
      await tx.supportConversation.updateMany({
        where: { id: { in: secondaryIds } },
        data: {
          deletedAt: now,
          mergedIntoConversationId: input.primaryConversationId,
        },
      });

      // Primary gets one MERGED event summarizing what folded in.
      await tx.supportConversationEvent.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.primaryConversationId,
          eventType: "MERGED",
          eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
          summary: `Merged ${secondaryIds.length} conversation(s) in`,
          detailsJson: {
            mergedFrom: secondaryIds,
            actorUserId: input.actorUserId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });

      // Each secondary gets its own MERGED event pointing at the primary.
      await tx.supportConversationEvent.createMany({
        data: secondaries.map((s) => ({
          workspaceId: input.workspaceId,
          conversationId: s.id,
          eventType: "MERGED" as const,
          eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
          summary: `Merged into ${input.primaryConversationId}`,
          detailsJson: {
            mergedInto: input.primaryConversationId,
            actorUserId: input.actorUserId,
            idempotencyKey: input.idempotencyKey,
          },
        })),
      });

      const firstSecondaryId = secondaryIds[0];
      if (!firstSecondaryId) {
        // Unreachable — secondaries.length asserted non-zero above — but
        // Prisma's types require a non-undefined id so we satisfy the compiler.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invariant: empty secondaries after length guard",
        });
      }

      const correction = await tx.supportGroupingCorrection.create({
        data: {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          kind: SUPPORT_GROUPING_CORRECTION_KIND.merge,
          sourceConversationId: firstSecondaryId,
          targetConversationId: input.primaryConversationId,
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true },
      });

      return correction.id;
    })
    .catch((error) => {
      // Concurrent submission of the same idempotencyKey landed first. Resolve
      // the existing correction id and return it.
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    });

  let resolvedCorrectionId: string;
  if (correctionId) {
    resolvedCorrectionId = correctionId;
  } else {
    const existingAfterConflict = await prisma.supportGroupingCorrection.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (!existingAfterConflict) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unique violation on merge but no existing correction found",
      });
    }
    resolvedCorrectionId = existingAfterConflict.id;
  }

  await writeAuditEvent({
    action: "support.conversation.merged",
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    targetType: "support_conversation",
    targetId: input.primaryConversationId,
    metadata: {
      correctionId: resolvedCorrectionId,
      mergedFrom: input.secondaryConversationIds,
      idempotencyKey: input.idempotencyKey,
    },
  });

  await Promise.all(
    [input.primaryConversationId, ...input.secondaryConversationIds].map((id) =>
      supportRealtime.emitConversationChanged({
        workspaceId: input.workspaceId,
        conversationId: id,
        reason: SUPPORT_REALTIME_REASON.groupingMerged,
      })
    )
  );

  // Structured log — stable keys per CLAUDE.md observability guidance. Every
  // correction emits one line with workspace + correction + kind, so per-
  // workspace correction rate aggregations (the input to the Part B learning
  // loop in plan §9) can be computed without a table scan.
  console.info("[grouping-correction] merge committed", {
    workspaceId: input.workspaceId,
    correctionId: resolvedCorrectionId,
    kind: SUPPORT_GROUPING_CORRECTION_KIND.merge,
    primaryConversationId: input.primaryConversationId,
    secondaryCount: input.secondaryConversationIds.length,
  });

  return {
    correctionId: resolvedCorrectionId,
    primaryConversationId: input.primaryConversationId,
    mergedSecondaryIds: input.secondaryConversationIds,
  };
}

/**
 * Move a single SupportConversationEvent (typically a MESSAGE_RECEIVED) from
 * its current conversation to a different one in the same workspace + channel.
 *
 * One-shot correction: this does not rewrite future Slack routing. Customer
 * messages that keep arriving on the original Slack thread still land on
 * the original conversation.
 */
export async function reassignEvent(input: ReassignEventInput): Promise<ReassignEventResult> {
  const existing = await prisma.supportGroupingCorrection.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, sourceEventId: true },
  });
  if (existing) {
    return {
      correctionId: existing.id,
      eventId: existing.sourceEventId ?? input.eventId,
    };
  }

  const event = await prisma.supportConversationEvent.findUnique({
    where: { id: input.eventId },
    select: {
      id: true,
      workspaceId: true,
      conversationId: true,
      eventType: true,
      conversation: {
        select: { installationId: true, channelId: true },
      },
    },
  });
  if (!event || event.workspaceId !== input.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Event not found in this workspace" });
  }
  if (event.eventType !== "MESSAGE_RECEIVED") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only MESSAGE_RECEIVED events can be reassigned",
    });
  }
  if (event.conversationId === input.targetConversationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Event is already on the target conversation",
    });
  }

  const target = await prisma.supportConversation.findUnique({
    where: { id: input.targetConversationId },
    select: {
      id: true,
      workspaceId: true,
      installationId: true,
      channelId: true,
      deletedAt: true,
    },
  });
  if (!target || target.workspaceId !== input.workspaceId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Target conversation not found in this workspace",
    });
  }
  if (target.deletedAt) {
    throw new TRPCError({ code: "CONFLICT", message: "Target conversation is archived" });
  }
  if (
    target.installationId !== event.conversation.installationId ||
    target.channelId !== event.conversation.channelId
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Source and target conversations are in different channels",
    });
  }

  const sourceConversationId = event.conversationId;

  const correctionId = await prisma
    .$transaction(async (tx) => {
      await tx.supportConversationEvent.update({
        where: { id: input.eventId },
        data: {
          conversationId: input.targetConversationId,
          reassignedFromConversationId: sourceConversationId,
        },
      });

      // Timeline breadcrumbs: one REASSIGNED_EVENT on source, one on target.
      await tx.supportConversationEvent.createMany({
        data: [
          {
            workspaceId: input.workspaceId,
            conversationId: sourceConversationId,
            eventType: "REASSIGNED_EVENT" as const,
            eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
            summary: `Event moved to ${input.targetConversationId}`,
            detailsJson: {
              eventId: input.eventId,
              movedTo: input.targetConversationId,
              actorUserId: input.actorUserId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          {
            workspaceId: input.workspaceId,
            conversationId: input.targetConversationId,
            eventType: "REASSIGNED_EVENT" as const,
            eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
            summary: `Event moved from ${sourceConversationId}`,
            detailsJson: {
              eventId: input.eventId,
              movedFrom: sourceConversationId,
              actorUserId: input.actorUserId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        ],
      });

      const correction = await tx.supportGroupingCorrection.create({
        data: {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          kind: SUPPORT_GROUPING_CORRECTION_KIND.reassignEvent,
          sourceConversationId: sourceConversationId,
          targetConversationId: input.targetConversationId,
          sourceEventId: input.eventId,
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true },
      });

      return correction.id;
    })
    .catch((error) => {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    });

  let resolvedCorrectionId: string;
  if (correctionId) {
    resolvedCorrectionId = correctionId;
  } else {
    const conflict = await prisma.supportGroupingCorrection.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (!conflict) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unique violation on reassign but no existing correction found",
      });
    }
    resolvedCorrectionId = conflict.id;
  }

  await writeAuditEvent({
    action: "support.conversation.reassigned_event",
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    targetType: "support_conversation_event",
    targetId: input.eventId,
    metadata: {
      correctionId: resolvedCorrectionId,
      from: sourceConversationId,
      to: input.targetConversationId,
      idempotencyKey: input.idempotencyKey,
    },
  });

  await Promise.all(
    [sourceConversationId, input.targetConversationId].map((id) =>
      supportRealtime.emitConversationChanged({
        workspaceId: input.workspaceId,
        conversationId: id,
        reason: SUPPORT_REALTIME_REASON.groupingReassigned,
      })
    )
  );

  console.info("[grouping-correction] reassign committed", {
    workspaceId: input.workspaceId,
    correctionId: resolvedCorrectionId,
    kind: SUPPORT_GROUPING_CORRECTION_KIND.reassignEvent,
    eventId: input.eventId,
    sourceConversationId,
    targetConversationId: input.targetConversationId,
  });

  return { correctionId: resolvedCorrectionId, eventId: input.eventId };
}

/**
 * Reverse a correction within the 24h window. Rejects if a LATER correction
 * depends on this one (formal definition below).
 *
 * Dependency: correction X depends on Y iff
 *   X.createdAt > Y.createdAt AND X.undoneAt IS NULL AND
 *   ({X.source, X.target, X.sourceEventId} ∩ {Y.source, Y.target, Y.sourceEventId}) ≠ ∅
 *
 * Rationale: if Y moved an event to conversation C and later correction X
 * merged C into another conversation, undoing Y would require moving the
 * event back to a conversation that is now soft-deleted and aliased. Reject
 * Y in that case and let the user contact support.
 */
export async function undoCorrection(input: UndoCorrectionInput): Promise<UndoCorrectionResult> {
  const correction = await prisma.supportGroupingCorrection.findUnique({
    where: { id: input.correctionId },
    select: {
      id: true,
      workspaceId: true,
      kind: true,
      sourceConversationId: true,
      targetConversationId: true,
      sourceEventId: true,
      undoneAt: true,
      createdAt: true,
    },
  });

  if (!correction || correction.workspaceId !== input.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Correction not found" });
  }

  if (correction.undoneAt) {
    throw new TRPCError({ code: "CONFLICT", message: "Correction already undone" });
  }

  const ageMs = Date.now() - correction.createdAt.getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Undo window has expired (24 hours). Contact support to resolve.",
    });
  }

  const involvedIds = [correction.sourceConversationId, correction.targetConversationId].filter(
    (id): id is string => Boolean(id)
  );

  const dependentCount = await prisma.supportGroupingCorrection.count({
    where: {
      workspaceId: input.workspaceId,
      id: { not: correction.id },
      createdAt: { gt: correction.createdAt },
      undoneAt: null,
      OR: [
        { sourceConversationId: { in: involvedIds } },
        { targetConversationId: { in: involvedIds } },
        ...(correction.sourceEventId ? [{ sourceEventId: correction.sourceEventId }] : []),
      ],
    },
  });

  if (dependentCount > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Can't undo — a later correction depends on this one. Contact support to resolve.",
    });
  }

  await prisma.$transaction(async (tx) => {
    if (correction.kind === SUPPORT_GROUPING_CORRECTION_KIND.merge) {
      // Resurrect the secondary (undo soft-delete + unlink mergedInto).
      await tx.supportConversation.updateMany({
        where: { id: correction.sourceConversationId },
        data: { deletedAt: null, mergedIntoConversationId: null },
      });

      // Remove the thread alias — Slack routing returns to the secondary.
      const secondary = await tx.supportConversation.findUniqueOrThrow({
        where: { id: correction.sourceConversationId },
        select: { installationId: true, channelId: true, threadTs: true },
      });
      await tx.supportConversationThreadAlias.deleteMany({
        where: {
          installationId: secondary.installationId,
          channelId: secondary.channelId,
          threadTs: secondary.threadTs,
          conversationId: correction.targetConversationId ?? undefined,
        },
      });

      // Timeline breadcrumb on both sides.
      await tx.supportConversationEvent.createMany({
        data: [
          {
            workspaceId: input.workspaceId,
            conversationId: correction.sourceConversationId,
            eventType: "MERGE_UNDONE" as const,
            eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
            summary: `Merge into ${correction.targetConversationId} undone`,
            detailsJson: {
              correctionId: correction.id,
              actorUserId: input.actorUserId,
            },
          },
          ...(correction.targetConversationId
            ? [
                {
                  workspaceId: input.workspaceId,
                  conversationId: correction.targetConversationId,
                  eventType: "MERGE_UNDONE" as const,
                  eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
                  summary: `Merge of ${correction.sourceConversationId} reversed`,
                  detailsJson: {
                    correctionId: correction.id,
                    actorUserId: input.actorUserId,
                  },
                },
              ]
            : []),
        ],
      });
    } else if (correction.kind === SUPPORT_GROUPING_CORRECTION_KIND.reassignEvent) {
      if (!correction.sourceEventId || !correction.targetConversationId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Malformed reassign correction — missing event or target",
        });
      }
      // Move the event back.
      await tx.supportConversationEvent.update({
        where: { id: correction.sourceEventId },
        data: {
          conversationId: correction.sourceConversationId,
          reassignedFromConversationId: null,
        },
      });

      await tx.supportConversationEvent.createMany({
        data: [
          {
            workspaceId: input.workspaceId,
            conversationId: correction.sourceConversationId,
            eventType: "REASSIGN_UNDONE" as const,
            eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
            summary: "Event reassignment undone",
            detailsJson: {
              correctionId: correction.id,
              eventId: correction.sourceEventId,
              actorUserId: input.actorUserId,
            },
          },
          {
            workspaceId: input.workspaceId,
            conversationId: correction.targetConversationId,
            eventType: "REASSIGN_UNDONE" as const,
            eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
            summary: `Event ${correction.sourceEventId} returned to origin`,
            detailsJson: {
              correctionId: correction.id,
              eventId: correction.sourceEventId,
              actorUserId: input.actorUserId,
            },
          },
        ],
      });
    }

    // Stamp the correction as undone last so a failure during event writes
    // aborts the whole transaction cleanly.
    await tx.supportGroupingCorrection.update({
      where: { id: correction.id },
      data: { undoneAt: new Date() },
    });
  });

  await writeAuditEvent({
    action:
      correction.kind === SUPPORT_GROUPING_CORRECTION_KIND.merge
        ? "support.conversation.merge_undone"
        : "support.conversation.reassign_undone",
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    targetType: "support_grouping_correction",
    targetId: correction.id,
    metadata: {
      kind: correction.kind,
      sourceConversationId: correction.sourceConversationId,
      targetConversationId: correction.targetConversationId,
    },
  });

  const touchedIds = [correction.sourceConversationId, correction.targetConversationId].filter(
    (id): id is string => Boolean(id)
  );
  await Promise.all(
    touchedIds.map((id) =>
      supportRealtime.emitConversationChanged({
        workspaceId: input.workspaceId,
        conversationId: id,
        reason: SUPPORT_REALTIME_REASON.groupingUndone,
      })
    )
  );

  console.info("[grouping-correction] undo committed", {
    workspaceId: input.workspaceId,
    correctionId: correction.id,
    kind: correction.kind,
  });

  return { correctionId: correction.id, kind: correction.kind };
}

import { createHash } from "node:crypto";
import { prisma } from "@shared/database";
import * as embeddings from "@shared/rest/services/codex/embedding";
import { KNOWLEDGE_CHUNK_SOURCE } from "@shared/types";
import { ApplicationFailure } from "@temporalio/common";

// ---------------------------------------------------------------------------
// support-resolution-knowledge.activity
//
// All I/O for the past-resolution embedding pipeline. Two activities:
//
//   embedSingleResolution(input)
//     - One DRAFT_APPROVED event → one chunk row. Used by the single-mode
//       workflow that runs on each draft approval.
//
//   embedBackfillBatch(input)
//     - Bounded-concurrency batch (default 5) over not-yet-indexed conversations.
//       Returns aggregate counts + `done` flag. Workflow loops until `done`.
//
// Failure classification: throws `ApplicationFailure` with stable `type` so
// the workflow's `nonRetryableErrorTypes` policy can classify properly.
// ---------------------------------------------------------------------------

const Q_MIN_CHARS = 20;
const BACKFILL_CONCURRENCY = 5;

export type EmbedSingleInput = {
  workspaceId: string;
  conversationId: string;
  sourceEventId: string;
};

export type EmbedSingleResult = {
  embedded: boolean;
  skippedAlreadyIndexed: boolean;
  skippedQTooShort: boolean;
  failed: boolean;
};

export type EmbedBackfillInput = {
  workspaceId: string;
  maxConversations?: number;
  iteration: number;
};

export type EmbedBackfillResult = {
  totalCandidates: number;
  embedded: number;
  skippedAlreadyIndexed: number;
  skippedQTooShort: number;
  failed: number;
  done: boolean;
};

export async function embedSingleResolution(input: EmbedSingleInput): Promise<EmbedSingleResult> {
  const result = await embedOne(input);
  return {
    embedded: result === "embedded",
    skippedAlreadyIndexed: result === "already_indexed",
    skippedQTooShort: result === "q_too_short",
    failed: result === "failed",
  };
}

export async function embedBackfillBatch(input: EmbedBackfillInput): Promise<EmbedBackfillResult> {
  const total = await countCandidates(input.workspaceId);
  const cap = input.maxConversations ?? Number.POSITIVE_INFINITY;
  const effectiveTotal = Math.min(total, cap);

  // Cap remaining candidates by the explicit maxConversations limit. Without
  // this, an iteration's LIMIT pulls BACKFILL_CONCURRENCY rows even when only
  // 1 row is requested overall.
  const remaining = Math.max(0, effectiveTotal - input.iteration * BACKFILL_CONCURRENCY);
  const batchSize = Math.min(BACKFILL_CONCURRENCY, remaining);
  if (batchSize === 0) {
    return {
      totalCandidates: effectiveTotal,
      embedded: 0,
      skippedAlreadyIndexed: 0,
      skippedQTooShort: 0,
      failed: 0,
      done: true,
    };
  }

  // Pull the next batch using OFFSET as the cursor. Without OFFSET, rows that
  // resolve to "q_too_short" or "failed" don't write a SupportResolutionEmbedding
  // row, so they reselect on every iteration and the workflow spins on the
  // same 5 unembeddable rows up to 1000 iterations (codex outside-voice F1).
  // OFFSET advances past anything we've already attempted in this run, even
  // when that attempt didn't produce a row.
  const offset = input.iteration * BACKFILL_CONCURRENCY;
  const candidates = await prisma.$queryRawUnsafe<
    Array<{ conversationId: string; sourceEventId: string }>
  >(
    `SELECT c."id" AS "conversationId", e."id" AS "sourceEventId"
     FROM "SupportConversation" c
     JOIN "SupportConversationEvent" e ON e."conversationId" = c."id"
     LEFT JOIN "SupportResolutionEmbedding" r
            ON r."sourceEventId" = e."id" AND r."deletedAt" IS NULL
     WHERE c."workspaceId" = $1
       AND c."deletedAt" IS NULL
       AND c."status" = 'DONE'
       AND e."eventType" = 'DRAFT_APPROVED'
       AND r."id" IS NULL
     ORDER BY e."createdAt" ASC
     OFFSET $3
     LIMIT $2`,
    input.workspaceId,
    batchSize,
    offset
  );

  if (candidates.length === 0) {
    return {
      totalCandidates: effectiveTotal,
      embedded: 0,
      skippedAlreadyIndexed: 0,
      skippedQTooShort: 0,
      failed: 0,
      done: true,
    };
  }

  const outcomes = await Promise.all(
    candidates.map((c) =>
      embedOne({
        workspaceId: input.workspaceId,
        conversationId: c.conversationId,
        sourceEventId: c.sourceEventId,
      }).catch((err) => {
        // For backfill we DON'T let one bad row kill the batch. Surface the
        // count of failures and continue. The workflow body will keep looping
        // until no candidates remain.
        const reason = err instanceof Error ? err.message : "unknown";
        console.warn("[support-resolution-knowledge] backfill row failed", {
          workspaceId: input.workspaceId,
          conversationId: c.conversationId,
          sourceEventId: c.sourceEventId,
          reason,
        });
        return "failed" as const;
      })
    )
  );

  const counts = {
    embedded: outcomes.filter((o) => o === "embedded").length,
    skippedAlreadyIndexed: outcomes.filter((o) => o === "already_indexed").length,
    skippedQTooShort: outcomes.filter((o) => o === "q_too_short").length,
    failed: outcomes.filter((o) => o === "failed").length,
  };

  // We're done when this batch returned fewer than the concurrency cap (no
  // more rows to process) OR when the optional cap is reached.
  const done = candidates.length < BACKFILL_CONCURRENCY;

  return {
    totalCandidates: effectiveTotal,
    embedded: counts.embedded,
    skippedAlreadyIndexed: counts.skippedAlreadyIndexed,
    skippedQTooShort: counts.skippedQTooShort,
    failed: counts.failed,
    done,
  };
}

type EmbedOutcome = "embedded" | "already_indexed" | "q_too_short" | "failed";

async function embedOne(input: EmbedSingleInput): Promise<EmbedOutcome> {
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, workspaceId: true, deletedAt: true },
  });
  if (!conversation || conversation.deletedAt !== null) {
    throw ApplicationFailure.create({
      type: "ConversationNotFoundError",
      message: `Conversation ${input.conversationId} not found or deleted.`,
      nonRetryable: true,
    });
  }
  // Cross-tenant consistency guard (codex outside-voice F3): the workflow
  // dispatcher is trusted, but defense in depth is cheap and a malformed
  // start would silently embed cross-tenant data. Search filters by
  // workspaceId so reads stay safe — the write side has to refuse mismatched
  // input here.
  if (conversation.workspaceId !== input.workspaceId) {
    throw ApplicationFailure.create({
      type: "ConversationNotFoundError",
      message: `Conversation ${input.conversationId} belongs to workspace ${conversation.workspaceId}, not ${input.workspaceId}.`,
      nonRetryable: true,
    });
  }

  const approvedEvent = await prisma.supportConversationEvent.findUnique({
    where: { id: input.sourceEventId },
    select: {
      id: true,
      conversationId: true,
      workspaceId: true,
      eventType: true,
      detailsJson: true,
      createdAt: true,
    },
  });
  if (!approvedEvent || approvedEvent.eventType !== "DRAFT_APPROVED") {
    throw ApplicationFailure.create({
      type: "ConversationNotFoundError",
      message: `Source event ${input.sourceEventId} is not a DRAFT_APPROVED event.`,
      nonRetryable: true,
    });
  }
  if (
    approvedEvent.workspaceId !== input.workspaceId ||
    approvedEvent.conversationId !== input.conversationId
  ) {
    throw ApplicationFailure.create({
      type: "ConversationNotFoundError",
      message: `Source event ${input.sourceEventId} does not belong to conversation ${input.conversationId} in workspace ${input.workspaceId}.`,
      nonRetryable: true,
    });
  }

  const qa = await extractQAPair({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    approvedEventId: approvedEvent.id,
    approvedEventCreatedAt: approvedEvent.createdAt,
  });

  if (!qa || qa.question.length < Q_MIN_CHARS) {
    return "q_too_short";
  }

  const embeddedText = `Q: ${qa.question}\n\nA: ${qa.answer}`;
  const contentHash = sha256(embeddedText);

  const existing = await prisma.supportResolutionEmbedding.findFirst({
    where: {
      workspaceId: input.workspaceId,
      OR: [
        { sourceEventId: input.sourceEventId, deletedAt: null },
        { contentHash, deletedAt: null },
      ],
    },
    select: { id: true },
  });
  if (existing) {
    return "already_indexed";
  }

  let embedding: number[] | undefined;
  try {
    [embedding] = await embeddings.generate([embeddings.splitIdentifiers(embeddedText)]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "embedding failure";
    if (/auth|401|forbidden|api[-_ ]?key/i.test(message)) {
      throw ApplicationFailure.create({
        type: "EmbeddingAuthError",
        message,
        nonRetryable: true,
      });
    }
    if (/rate[-_ ]?limit|429|too many requests/i.test(message)) {
      throw ApplicationFailure.create({
        type: "EmbeddingRateLimitedError",
        message,
      });
    }
    throw err;
  }
  if (!embedding) {
    throw ApplicationFailure.create({
      type: "EmbeddingAuthError",
      message: "Embedding service produced no vector.",
      nonRetryable: true,
    });
  }

  const insertOutcome = await prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "SupportResolutionEmbedding" (
         "id", "workspaceId", "conversationId", "sourceEventId",
         "embeddedText", "embedding", "tsv", "contentHash", "createdAt"
       ) VALUES (
         gen_random_uuid()::text, $1, $2, $3,
         $4, $5::vector, to_tsvector('english', $4),
         $6, NOW()
       )
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      input.workspaceId,
      input.conversationId,
      input.sourceEventId,
      embeddedText,
      embeddings.formatVector(embedding!),
      contentHash
    );
    const created = inserted[0];
    if (!created) {
      // Conflict won — another writer beat us to it. Bubble up as already-indexed
      // so the workflow's count metrics don't double-count this as a fresh embed.
      return { embedded: false } as const;
    }

    await tx.knowledgeIndexEntry.create({
      data: {
        workspaceId: input.workspaceId,
        source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
        sourceRecordId: created.id,
      },
    });
    return { embedded: true } as const;
  });

  return insertOutcome.embedded ? "embedded" : "already_indexed";
}

type QAExtractionInput = {
  workspaceId: string;
  conversationId: string;
  approvedEventId: string;
  approvedEventCreatedAt: Date;
};

type QAPair = { question: string; answer: string };

async function extractQAPair(input: QAExtractionInput): Promise<QAPair | null> {
  // Q: concatenated CUSTOMER messages from BEFORE the approved event.
  // A: the approved draft body, stored in detailsJson on the DRAFT_APPROVED
  //    event (or on the linked SupportDraft if available).
  // NOTE (codex outside-voice T6): Slack threads are multi-turn and
  // questions are often implicit. This extraction is a heuristic. It will
  // miss obvious cases; dogfood will surface them and we'll tune.

  const customerEvents = await prisma.supportConversationEvent.findMany({
    where: {
      conversationId: input.conversationId,
      eventType: "MESSAGE_RECEIVED",
      eventSource: "CUSTOMER",
      createdAt: { lt: input.approvedEventCreatedAt },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { detailsJson: true },
  });

  const questionParts: string[] = [];
  for (const ev of customerEvents) {
    const text = extractMessageText(ev.detailsJson);
    if (text) questionParts.push(text);
  }
  const question = questionParts.join("\n").trim();
  if (!question) return null;

  // A: prefer the SupportDraft body that the approval references.
  const approvedEvent = await prisma.supportConversationEvent.findUnique({
    where: { id: input.approvedEventId },
    select: { detailsJson: true },
  });
  const draftId = extractDraftId(approvedEvent?.detailsJson);
  let answer = "";
  if (draftId) {
    const draft = await prisma.supportDraft.findUnique({
      where: { id: draftId },
      select: { draftBody: true, editedBody: true },
    });
    // Prefer the operator-edited body (what actually got sent) over the
    // original draft body. If the operator approved as-is, editedBody is null
    // and we fall back to draftBody.
    answer = (draft?.editedBody ?? draft?.draftBody ?? "").trim();
  }

  if (!answer) {
    return null;
  }

  return { question, answer };
}

async function countCandidates(workspaceId: string): Promise<number> {
  const result = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(DISTINCT c."id")::bigint AS total
     FROM "SupportConversation" c
     JOIN "SupportConversationEvent" e ON e."conversationId" = c."id"
     WHERE c."workspaceId" = $1
       AND c."deletedAt" IS NULL
       AND c."status" = 'DONE'
       AND e."eventType" = 'DRAFT_APPROVED'`,
    workspaceId
  );
  return Number(result[0]?.total ?? 0n);
}

function extractMessageText(detailsJson: unknown): string | null {
  if (!detailsJson || typeof detailsJson !== "object") return null;
  const candidate = detailsJson as { text?: unknown; body?: unknown; message?: unknown };
  for (const key of ["text", "body", "message"] as const) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractDraftId(detailsJson: unknown): string | null {
  if (!detailsJson || typeof detailsJson !== "object") return null;
  const candidate = detailsJson as { draftId?: unknown };
  return typeof candidate.draftId === "string" ? candidate.draftId : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

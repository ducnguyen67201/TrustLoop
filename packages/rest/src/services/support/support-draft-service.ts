// ---------------------------------------------------------------------------
// supportDraft service
//
// Domain helpers for SupportDraft writes that span domain boundaries.
// Import as a namespace:
//
//   import * as supportDrafts from "@shared/rest/services/support/support-draft-service";
//   await supportDrafts.linkPullRequest(tx, { workspaceId, conversationId, prUrl, prNumber });
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

import { DRAFT_STATUS, createDraftPullRequestSuccessSchema } from "@shared/types";
import { z } from "zod";

// Structural client so callers can pass either the live prisma client or a
// $transaction() callback's tx. Keeps the service callable from inside an
// agent-team activity transaction without coupling to Prisma's tx generic
// (which the soft-delete .$extends wrapper hides).
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate args are model-specific generics
type DelegateFn = (args: any) => Promise<any>;
export interface SupportDraftMutationClient {
  supportDraft: {
    findMany: DelegateFn;
    update: DelegateFn;
  };
}

const linkPullRequestInputSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  // Reuse the success-shape validator so prUrl is regex-pinned to
  // https://github.com/{owner}/{repo}/pull/{n} and prNumber is a positive int.
  // Defense in depth: even if the agent boundary already validated the tool
  // result, we re-validate at the DB write boundary so a future caller that
  // forgets to validate cannot poison this field.
  prUrl: createDraftPullRequestSuccessSchema.shape.prUrl,
  prNumber: createDraftPullRequestSuccessSchema.shape.prNumber,
});

export type LinkPullRequestInput = z.infer<typeof linkPullRequestInputSchema>;

export interface LinkPullRequestResult {
  /** True when a draft was found and updated (or already had the same prUrl). */
  linked: boolean;
  /** The draft id that received the link, when one matched. */
  draftId: string | null;
  /** Set when the call was a no-op because the draft already had this prUrl. */
  alreadyLinked: boolean;
}

/**
 * Attach a freshly-created PR to the most operator-relevant draft on a
 * conversation. The chosen draft is the one the operator is most likely
 * looking at right now:
 *
 *   AWAITING_APPROVAL > APPROVED > SENT, ties broken by createdAt DESC
 *
 * Drafts in transient/terminal-error states (GENERATING, SENDING,
 * SEND_FAILED, DELIVERY_UNKNOWN, DISMISSED, FAILED) are intentionally
 * skipped — surfacing a PR link there would be confusing or invisible.
 *
 * Returns `{ linked: false }` rather than throwing when no eligible draft
 * exists (e.g. operator started the agent-team run before any analysis
 * finished, or the draft was dismissed mid-run). The caller's job — running
 * a long-lived team workflow — should not fail because the UI surface
 * disappeared.
 *
 * Idempotent: if the chosen draft already has the same prUrl set,
 * returns `{ linked: true, alreadyLinked: true }` without writing.
 *
 * Workspace-scoped via the draft's own workspaceId column. The query
 * filters on both workspaceId AND conversationId, so a conversation
 * belonging to workspace A cannot have one of its drafts mutated by a
 * call carrying workspace B's id.
 */
export async function linkPullRequest(
  client: SupportDraftMutationClient,
  input: LinkPullRequestInput
): Promise<LinkPullRequestResult> {
  const parsed = linkPullRequestInputSchema.parse(input);

  // Pull a small window of recent eligible drafts and pick the priority
  // winner in code (Prisma can't sort by enum priority cleanly).
  const candidates = await client.supportDraft.findMany({
    where: {
      workspaceId: parsed.workspaceId,
      conversationId: parsed.conversationId,
      deletedAt: null,
      status: { in: [DRAFT_STATUS.awaitingApproval, DRAFT_STATUS.approved, DRAFT_STATUS.sent] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, prUrl: true, createdAt: true },
    take: 5,
  });

  const winner = pickPriorityDraft(candidates);
  if (!winner) {
    return { linked: false, draftId: null, alreadyLinked: false };
  }

  if (winner.prUrl === parsed.prUrl) {
    return { linked: true, draftId: winner.id, alreadyLinked: true };
  }

  await client.supportDraft.update({
    where: { id: winner.id },
    data: { prUrl: parsed.prUrl, prNumber: parsed.prNumber },
  });

  return { linked: true, draftId: winner.id, alreadyLinked: false };
}

interface DraftCandidate {
  id: string;
  status: string;
  prUrl: string | null;
  createdAt: Date;
}

const STATUS_PRIORITY: Record<string, number> = {
  [DRAFT_STATUS.awaitingApproval]: 0,
  [DRAFT_STATUS.approved]: 1,
  [DRAFT_STATUS.sent]: 2,
};

function pickPriorityDraft(candidates: DraftCandidate[]): DraftCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce<DraftCandidate | null>((best, current) => {
    if (!best) return current;
    const bestRank = STATUS_PRIORITY[best.status] ?? 99;
    const currentRank = STATUS_PRIORITY[current.status] ?? 99;
    if (currentRank < bestRank) return current;
    if (currentRank === bestRank && current.createdAt > best.createdAt) return current;
    return best;
  }, null);
}

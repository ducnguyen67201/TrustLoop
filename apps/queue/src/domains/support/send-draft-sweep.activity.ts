import { prisma } from "@shared/database";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { DRAFT_DISPATCH_KIND, DRAFT_DISPATCH_STATUS } from "@shared/types";

// ---------------------------------------------------------------------------
// send-draft-sweep activity
//
// Outbox reconciliation. approveDraft commits a DraftDispatch row with
// status=PENDING inside the same transaction that moves the draft to
// APPROVED, then best-effort-dispatches sendDraftToSlackWorkflow. If that
// dispatch call fails (Temporal outage, network) the outbox row stays
// PENDING. This activity scans for PENDING rows older than the staleness
// threshold and retries the dispatch. REJECT_DUPLICATE on the workflow ID
// means an accidental race with the normal path is harmless.
// ---------------------------------------------------------------------------

const STALENESS_SECONDS = 120;
const BATCH_SIZE = 100;

export interface SweepResult {
  examined: number;
  redispatched: number;
  alreadyStarted: number;
  errors: number;
}

export async function sweepStaleDraftDispatches(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - STALENESS_SECONDS * 1000);
  const stale = await prisma.draftDispatch.findMany({
    where: {
      status: DRAFT_DISPATCH_STATUS.pending,
      kind: DRAFT_DISPATCH_KIND.sendToSlack,
      createdAt: { lt: cutoff },
    },
    select: { id: true, draftId: true, workspaceId: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let redispatched = 0;
  let alreadyStarted = 0;
  let errors = 0;

  for (const row of stale) {
    try {
      const handle = await temporalWorkflowDispatcher.startSendDraftToSlackWorkflow({
        draftId: row.draftId,
        dispatchId: row.id,
        workspaceId: row.workspaceId,
      });
      await prisma.draftDispatch.update({
        where: { id: row.id },
        data: { workflowId: handle.workflowId, attempts: { increment: 1 } },
      });
      redispatched += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // REJECT_DUPLICATE rejection means a workflow for this draftId is
      // already running (happy path won, or an earlier sweep). That is the
      // intended idempotency guarantee — leave the row for the next sweep
      // to observe its terminal status.
      if (message.includes("WorkflowExecutionAlreadyStarted")) {
        alreadyStarted += 1;
        continue;
      }
      errors += 1;
      await prisma.draftDispatch.update({
        where: { id: row.id },
        data: { lastError: message, attempts: { increment: 1 } },
      });
    }
  }

  return { examined: stale.length, redispatched, alreadyStarted, errors };
}

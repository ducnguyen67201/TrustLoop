import type * as sweepActivities from "@/domains/support/send-draft-sweep.activity";
import { proxyActivities } from "@temporalio/workflow";

// ---------------------------------------------------------------------------
// sendDraftSweepWorkflow
//
// Cron-style workflow that runs every minute and asks the activity to
// redispatch stale PENDING DraftDispatch rows. Kept deliberately thin —
// the workflow is just a scheduled trigger; all I/O and Temporal client
// access happens in the activity.
// ---------------------------------------------------------------------------

const activities = proxyActivities<typeof sweepActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3 },
});

export async function sendDraftSweepWorkflow(): Promise<sweepActivities.SweepResult> {
  return activities.sweepStaleDraftDispatches();
}

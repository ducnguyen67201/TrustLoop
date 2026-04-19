import type * as purgeActivities from "@/domains/maintenance/purge.activity";
import { proxyActivities } from "@temporalio/workflow";

const activities = proxyActivities<typeof purgeActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3 },
});

export async function purgeDeletedRecordsWorkflow(input?: {
  retentionDays?: number;
}): Promise<{ totalDeleted: number }> {
  const result = await activities.runPurgeDeletedRecords({
    retentionDays: input?.retentionDays,
    dryRun: false,
  });
  return { totalDeleted: result.totalDeleted };
}

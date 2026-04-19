import { prismaRaw, purgeDeletedRecords } from "@shared/database";

const DEFAULT_RETENTION_DAYS = 90;

interface PurgeInput {
  retentionDays?: number;
  dryRun?: boolean;
}

interface PurgeOutput {
  results: Array<{ model: string; deletedCount: number }>;
  totalDeleted: number;
  retentionDays: number;
  dryRun: boolean;
}

export async function runPurgeDeletedRecords(input: PurgeInput = {}): Promise<PurgeOutput> {
  const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const dryRun = input.dryRun ?? false;

  const results = await purgeDeletedRecords(prismaRaw, { retentionDays, dryRun });
  const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);

  console.log(
    `[purge] ${dryRun ? "Dry run" : "Purged"}: ${totalDeleted} records past ${retentionDays}-day retention`
  );

  return { results, totalDeleted, retentionDays, dryRun };
}

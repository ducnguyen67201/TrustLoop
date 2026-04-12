import { prisma } from "@shared/database";
import * as slackUser from "@shared/rest/services/support/adapters/slack/slack-user-service";

export async function refreshCustomerProfile(input: {
  workspaceId: string;
  installationId: string;
  slackUserId: string;
}): Promise<void> {
  const cached = await slackUser.getCachedProfile(input.installationId, input.slackUserId);

  if (cached) {
    return;
  }

  const installation = await prisma.supportInstallation.findUnique({
    where: { id: input.installationId },
    select: { metadata: true },
  });

  if (!installation) {
    return;
  }

  try {
    await slackUser.refreshProfile(
      input.installationId,
      input.workspaceId,
      input.slackUserId,
      installation.metadata
    );
  } catch (err) {
    console.warn("[support] customer profile refresh failed", {
      slackUserId: input.slackUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncDataGuard } from "@/components/ui/async-data-guard";
import { SlackConnectionCard } from "@/components/workspace/slack-connection-card";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useSlackInstallation } from "@/hooks/use-slack-installation";
import { SLACK_OAUTH_STATUS, WORKSPACE_ROLE } from "@shared/types";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Workspace integrations settings page.
 * Lets admins connect/disconnect Slack via OAuth.
 */
export default function WorkspaceIntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuthSession();
  const slack = useSlackInstallation();

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
    }
  }, [auth.isLoading, auth.session, router]);

  const canManage =
    auth.session?.role === WORKSPACE_ROLE.OWNER || auth.session?.role === WORKSPACE_ROLE.ADMIN;

  /* Read ?slack= query param for post-OAuth feedback */
  const slackStatus = searchParams.get("slack");

  return (
    <AsyncDataGuard
      isLoading={auth.isLoading || slack.isLoading}
      data={slack.data}
      error={slack.error}
      loadingTitle="Loading integrations"
      loadingDescription="Checking connected services..."
      errorTitle="Unable to load integrations"
    >
      {() => (
        <main className="space-y-6">
          <header>
            <h1 className="text-2xl font-semibold">Integrations</h1>
            <p className="text-muted-foreground text-sm">
              Connect external services to your workspace.
            </p>
          </header>

          {/* Post-OAuth status alerts */}
          {slackStatus === SLACK_OAUTH_STATUS.CONNECTED ? (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <AlertTitle>Slack connected</AlertTitle>
              <AlertDescription>
                Your Slack workspace is now linked. Messages from subscribed channels will appear in
                your support inbox.
              </AlertDescription>
            </Alert>
          ) : null}

          {slackStatus === SLACK_OAUTH_STATUS.ERROR ? (
            <Alert variant="destructive">
              <AlertTitle>Connection failed</AlertTitle>
              <AlertDescription>
                Something went wrong during the Slack OAuth flow. Please try again.
              </AlertDescription>
            </Alert>
          ) : null}

          {slackStatus === SLACK_OAUTH_STATUS.DENIED ? (
            <Alert>
              <AlertTitle>Connection cancelled</AlertTitle>
              <AlertDescription>
                You denied the Slack authorization request. No changes were made.
              </AlertDescription>
            </Alert>
          ) : null}

          {!canManage ? (
            <Alert>
              <AlertTitle>Read-only view</AlertTitle>
              <AlertDescription>
                Your role is `{auth.session?.role ?? WORKSPACE_ROLE.MEMBER}`. Only `OWNER` and
                `ADMIN` can manage integrations.
              </AlertDescription>
            </Alert>
          ) : null}

          <SlackConnectionCard
            installation={slack.slackInstallation}
            onConnect={slack.connect}
            onDisconnect={slack.disconnect}
            isConnecting={slack.isConnecting}
            canManage={canManage}
          />
        </main>
      )}
    </AsyncDataGuard>
  );
}

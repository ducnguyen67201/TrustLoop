"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import { useCallback, useEffect, useState } from "react";

type SlackInstallationSummary = {
  id: string;
  provider: "SLACK";
  teamId: string;
  teamName: string | null;
  botUserId: string | null;
  providerInstallationId: string;
  connectedAt: string;
};

type InstallationListResponse = {
  installations: SlackInstallationSummary[];
};

/**
 * Loads Slack installation state and provides connect/disconnect actions.
 */
export function useSlackInstallation() {
  const [data, setData] = useState<InstallationListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<InstallationListResponse>("supportInstallation.list");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load integrations");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const result = await trpcQuery<{ authorizeUrl: string }>(
        "supportInstallation.getSlackOAuthUrl"
      );
      window.location.href = result.authorizeUrl;
    } catch (connectError) {
      setError(
        connectError instanceof Error ? connectError.message : "Failed to start Slack connection"
      );
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(
    async (installationId: string) => {
      setError(null);

      try {
        await trpcMutation<{ installationId: string }, { disconnected: true }>(
          "supportInstallation.disconnect",
          { installationId },
          { withCsrf: true }
        );
        await refresh();
      } catch (disconnectError) {
        setError(
          disconnectError instanceof Error ? disconnectError.message : "Failed to disconnect Slack"
        );
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load integrations");
      setIsLoading(false);
    });
  }, [refresh]);

  /** First Slack installation, or null if none connected. */
  const slackInstallation = data?.installations.find((i) => i.provider === "SLACK") ?? null;

  return {
    data,
    slackInstallation,
    isLoading,
    isConnecting,
    error,
    refresh,
    connect,
    disconnect,
  };
}

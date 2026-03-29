"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type { WorkspaceActiveResponse, WorkspaceSwitchResponse } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Handles active workspace read + switch operations.
 */
export function useActiveWorkspace() {
  const [data, setData] = useState<WorkspaceActiveResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<WorkspaceActiveResponse>("workspace.getActive");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load active workspace");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    setError(null);

    const result = await trpcMutation<{ workspaceId: string }, WorkspaceSwitchResponse>(
      "workspace.switchActive",
      { workspaceId },
      { withCsrf: true }
    );

    setData((previous) => ({
      activeWorkspaceId: result.activeWorkspaceId,
      role: previous?.role ?? null,
    }));

    return result;
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load active workspace");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
    switchWorkspace,
  };
}

"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type { WorkspaceDetailsResponse, WorkspaceRenameResponse } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads workspace details and provides rename action.
 */
export function useWorkspaceDetails() {
  const [data, setData] = useState<WorkspaceDetailsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<WorkspaceDetailsResponse>("workspace.getDetails");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load workspace details");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const rename = useCallback(
    async (name: string) => {
      setError(null);

      const result = await trpcMutation<{ name: string }, WorkspaceRenameResponse>(
        "workspace.rename",
        { name },
        { withCsrf: true }
      );

      await refresh();
      return result;
    },
    [refresh]
  );

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load workspace details");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
    rename,
  };
}

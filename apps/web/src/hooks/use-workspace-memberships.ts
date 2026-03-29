"use client";

import { trpcQuery } from "@/lib/trpc-http";
import type { WorkspaceMembershipListResponse } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads the authenticated user's workspace memberships for switcher and settings views.
 */
export function useWorkspaceMemberships() {
  const [data, setData] = useState<WorkspaceMembershipListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<WorkspaceMembershipListResponse>(
        "workspace.listMyMemberships"
      );
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load memberships");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load memberships");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}

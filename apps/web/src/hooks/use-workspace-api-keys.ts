"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  WorkspaceApiKeyCreateRequest,
  WorkspaceApiKeyCreateResponse,
  WorkspaceApiKeyListResponse,
  WorkspaceApiKeyRevokeResponse,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads and mutates workspace API keys for settings screens.
 */
export function useWorkspaceApiKeys() {
  const [data, setData] = useState<WorkspaceApiKeyListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<WorkspaceApiKeyListResponse>("workspaceApiKey.list");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load API keys");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createKey = useCallback(
    async (input: WorkspaceApiKeyCreateRequest) => {
      setError(null);

      const result = await trpcMutation<
        WorkspaceApiKeyCreateRequest,
        WorkspaceApiKeyCreateResponse
      >("workspaceApiKey.create", input, { withCsrf: true });

      await refresh();
      return result;
    },
    [refresh]
  );

  const revokeKey = useCallback(
    async (keyId: string) => {
      setError(null);

      await trpcMutation<{ keyId: string }, WorkspaceApiKeyRevokeResponse>(
        "workspaceApiKey.revoke",
        { keyId },
        { withCsrf: true }
      );

      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load API keys");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
    createKey,
    revokeKey,
  };
}

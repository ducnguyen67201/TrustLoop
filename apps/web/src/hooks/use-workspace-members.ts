"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  WorkspaceMemberAddRequest,
  WorkspaceMemberAddResponse,
  WorkspaceMemberListResponse,
  WorkspaceMemberRemoveResponse,
  WorkspaceMemberUpdateRoleRequest,
  WorkspaceMemberUpdateRoleResponse,
  WorkspaceRole,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads and mutates members in the active workspace.
 */
export function useWorkspaceMembers() {
  const [data, setData] = useState<WorkspaceMemberListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<WorkspaceMemberListResponse>("workspace.listMembers");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load workspace members");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addMember = useCallback(
    async (input: { email: string; role: WorkspaceRole }) => {
      setError(null);
      await trpcMutation<WorkspaceMemberAddRequest, WorkspaceMemberAddResponse>(
        "workspace.addMember",
        input,
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  const updateMemberRole = useCallback(
    async (input: { userId: string; role: WorkspaceRole }) => {
      setError(null);
      await trpcMutation<WorkspaceMemberUpdateRoleRequest, WorkspaceMemberUpdateRoleResponse>(
        "workspace.updateMemberRole",
        input,
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  const removeMember = useCallback(
    async (userId: string) => {
      setError(null);
      await trpcMutation<{ userId: string }, WorkspaceMemberRemoveResponse>(
        "workspace.removeMember",
        { userId },
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load workspace members");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
    addMember,
    updateMemberRole,
    removeMember,
  };
}

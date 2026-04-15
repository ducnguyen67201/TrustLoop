"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  AddAgentTeamEdgeInput,
  AddAgentTeamRoleInput,
  AgentTeam,
  CreateAgentTeamInput,
  DeleteAgentTeamInput,
  ListAgentTeamsResponse,
  RemoveAgentTeamEdgeInput,
  RemoveAgentTeamRoleInput,
  SetDefaultAgentTeamInput,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads and mutates workspace agent-team configuration for settings screens.
 */
export function useAgentTeams() {
  const [data, setData] = useState<ListAgentTeamsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<ListAgentTeamsResponse>("agentTeam.list");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load agent teams");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createTeam = useCallback(
    async (input: CreateAgentTeamInput) => {
      setError(null);
      const created = await trpcMutation<CreateAgentTeamInput, AgentTeam>(
        "agentTeam.create",
        input,
        {
          withCsrf: true,
        }
      );
      await refresh();
      return created;
    },
    [refresh]
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      setError(null);
      await trpcMutation<DeleteAgentTeamInput, ListAgentTeamsResponse>(
        "agentTeam.delete",
        { teamId },
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  const setDefaultTeam = useCallback(
    async (teamId: string) => {
      setError(null);
      await trpcMutation<SetDefaultAgentTeamInput, AgentTeam>(
        "agentTeam.setDefault",
        { teamId },
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  const addRole = useCallback(
    async (input: AddAgentTeamRoleInput) => {
      setError(null);
      await trpcMutation<AddAgentTeamRoleInput, AgentTeam>("agentTeam.addRole", input, {
        withCsrf: true,
      });
      await refresh();
    },
    [refresh]
  );

  const removeRole = useCallback(
    async (roleId: string) => {
      setError(null);
      await trpcMutation<RemoveAgentTeamRoleInput, AgentTeam>(
        "agentTeam.removeRole",
        { roleId },
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  const addEdge = useCallback(
    async (input: AddAgentTeamEdgeInput) => {
      setError(null);
      await trpcMutation<AddAgentTeamEdgeInput, AgentTeam>("agentTeam.addEdge", input, {
        withCsrf: true,
      });
      await refresh();
    },
    [refresh]
  );

  const removeEdge = useCallback(
    async (edgeId: string) => {
      setError(null);
      await trpcMutation<RemoveAgentTeamEdgeInput, AgentTeam>(
        "agentTeam.removeEdge",
        { edgeId },
        { withCsrf: true }
      );
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    refresh().catch(() => {
      setError("Failed to load agent teams");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    data,
    isLoading,
    error,
    refresh,
    createTeam,
    deleteTeam,
    setDefaultTeam,
    addRole,
    removeRole,
    addEdge,
    removeEdge,
  };
}

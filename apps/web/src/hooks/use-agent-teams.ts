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
  UpdateAgentTeamLayoutInput,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

export class AgentTeamLayoutConflictError extends Error {
  latestTeam: AgentTeam;

  constructor(message: string, latestTeam: AgentTeam) {
    super(message);
    this.name = "AgentTeamLayoutConflictError";
    this.latestTeam = latestTeam;
  }
}

function replaceTeam(
  current: ListAgentTeamsResponse | null,
  nextTeam: AgentTeam
): ListAgentTeamsResponse | null {
  if (!current) {
    return current;
  }

  return {
    teams: current.teams.map((team) => (team.id === nextTeam.id ? nextTeam : team)),
  };
}

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

  const getTeam = useCallback(async (teamId: string) => {
    return trpcQuery<AgentTeam, { teamId: string }>("agentTeam.get", { teamId });
  }, []);

  const reloadTeam = useCallback(
    async (teamId: string) => {
      const team = await getTeam(teamId);
      setData((current) => replaceTeam(current, team));
      return team;
    },
    [getTeam]
  );

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

  const addRole = useCallback(async (input: AddAgentTeamRoleInput) => {
    setError(null);
    const updatedTeam = await trpcMutation<AddAgentTeamRoleInput, AgentTeam>(
      "agentTeam.addRole",
      input,
      {
        withCsrf: true,
      }
    );
    setData((current) => replaceTeam(current, updatedTeam));
  }, []);

  const removeRole = useCallback(async (roleId: string) => {
    setError(null);
    const updatedTeam = await trpcMutation<RemoveAgentTeamRoleInput, AgentTeam>(
      "agentTeam.removeRole",
      { roleId },
      { withCsrf: true }
    );
    setData((current) => replaceTeam(current, updatedTeam));
  }, []);

  const addEdge = useCallback(async (input: AddAgentTeamEdgeInput) => {
    setError(null);
    const updatedTeam = await trpcMutation<AddAgentTeamEdgeInput, AgentTeam>(
      "agentTeam.addEdge",
      input,
      {
        withCsrf: true,
      }
    );
    setData((current) => replaceTeam(current, updatedTeam));
    return updatedTeam;
  }, []);

  const removeEdge = useCallback(async (edgeId: string) => {
    setError(null);
    const updatedTeam = await trpcMutation<RemoveAgentTeamEdgeInput, AgentTeam>(
      "agentTeam.removeEdge",
      { edgeId },
      { withCsrf: true }
    );
    setData((current) => replaceTeam(current, updatedTeam));
    return updatedTeam;
  }, []);

  const updateLayout = useCallback(
    async (input: UpdateAgentTeamLayoutInput) => {
      setError(null);

      try {
        const updatedTeam = await trpcMutation<UpdateAgentTeamLayoutInput, AgentTeam>(
          "agentTeam.updateLayout",
          input,
          { withCsrf: true }
        );
        setData((current) => replaceTeam(current, updatedTeam));
        return updatedTeam;
      } catch (mutationError) {
        const message =
          mutationError instanceof Error ? mutationError.message : "Failed to save team layout";

        if (message.includes("Layout changed elsewhere")) {
          const latestTeam = await getTeam(input.teamId);
          throw new AgentTeamLayoutConflictError(message, latestTeam);
        }

        throw mutationError;
      }
    },
    [getTeam]
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
    reloadTeam,
    createTeam,
    deleteTeam,
    setDefaultTeam,
    addRole,
    removeRole,
    addEdge,
    removeEdge,
    updateLayout,
  };
}

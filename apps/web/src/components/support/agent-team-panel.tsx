"use client";

import { AgentTeamRunView } from "@/components/support/agent-team-run-view";
import { useAgentTeamRun } from "@/hooks/use-agent-team-run";

interface AgentTeamPanelProps {
  conversationId: string;
  workspaceId: string;
}

/**
 * Container for the live agent-team run panel inside a support conversation.
 */
export function AgentTeamPanel({ conversationId, workspaceId }: AgentTeamPanelProps) {
  const agentTeamRun = useAgentTeamRun(conversationId, workspaceId);

  return (
    <AgentTeamRunView
      error={agentTeamRun.error}
      isLoading={agentTeamRun.isLoading}
      isMutating={agentTeamRun.isMutating}
      isStreaming={agentTeamRun.isStreaming}
      onStartRun={() => void agentTeamRun.startRun()}
      run={agentTeamRun.run}
    />
  );
}

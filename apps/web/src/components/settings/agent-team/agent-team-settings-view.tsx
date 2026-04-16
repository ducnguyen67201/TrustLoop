"use client";

import { CreateTeamDialog } from "@/components/settings/agent-team/create-team-dialog";
import { TeamDetailSection } from "@/components/settings/agent-team/team-detail-section";
import { TeamListSection } from "@/components/settings/agent-team/team-list-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncDataGuard } from "@/components/ui/async-data-guard";
import { useAgentTeams } from "@/hooks/use-agent-teams";
import { useAuthSession } from "@/hooks/use-auth-session";
import { WORKSPACE_ROLE } from "@shared/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Workspace settings surface for configuring multi-agent team blueprints.
 * Two-column layout: narrow team list on left, graph + detail on right.
 */
export function AgentTeamSettingsView() {
  const router = useRouter();
  const auth = useAuthSession();
  const agentTeams = useAgentTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
    }
  }, [auth.isLoading, auth.session, router]);

  useEffect(() => {
    if (!agentTeams.data) {
      return;
    }

    if (!selectedTeamId || !agentTeams.data.teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(agentTeams.data.teams[0]?.id ?? null);
    }
  }, [agentTeams.data, selectedTeamId]);

  const canManage =
    auth.session?.role === WORKSPACE_ROLE.OWNER || auth.session?.role === WORKSPACE_ROLE.ADMIN;
  const selectedTeam = agentTeams.data?.teams.find((team) => team.id === selectedTeamId) ?? null;

  return (
    <AsyncDataGuard
      isLoading={auth.isLoading || agentTeams.isLoading}
      data={agentTeams.data}
      error={agentTeams.error}
      loadingTitle="Loading agent teams"
      loadingDescription="Fetching team definitions, roles, and connections..."
      errorTitle="Unable to load agent teams"
    >
      {(agentTeamData) => (
        <main className="space-y-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Agent Teams</h1>
            <p className="text-sm text-muted-foreground">
              Build your team of AI specialists. Connect them. Watch them collaborate.
            </p>
          </header>

          {!canManage ? (
            <Alert>
              <AlertTitle>Read-only view</AlertTitle>
              <AlertDescription>
                Your role is `{auth.session?.role ?? WORKSPACE_ROLE.MEMBER}`. Only `OWNER` and
                `ADMIN` can change team configuration.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <TeamListSection
              teams={agentTeamData.teams}
              selectedTeamId={selectedTeamId}
              canManage={canManage}
              onSelectTeam={setSelectedTeamId}
              onSetDefaultTeam={agentTeams.setDefaultTeam}
              onDeleteTeam={agentTeams.deleteTeam}
              createTeamDialog={<CreateTeamDialog onCreate={agentTeams.createTeam} />}
            />

            <TeamDetailSection
              team={selectedTeam}
              canManage={canManage}
              onAddRole={agentTeams.addRole}
              onRemoveRole={agentTeams.removeRole}
              onAddEdge={agentTeams.addEdge}
              onRemoveEdge={agentTeams.removeEdge}
              onUpdateLayout={agentTeams.updateLayout}
              onReloadTeam={agentTeams.reloadTeam}
            />
          </div>
        </main>
      )}
    </AsyncDataGuard>
  );
}

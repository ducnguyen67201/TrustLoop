"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RiDeleteBinLine } from "@remixicon/react";
import type { AgentTeam } from "@shared/types";

interface TeamListSectionProps {
  teams: AgentTeam[];
  selectedTeamId: string | null;
  canManage: boolean;
  onSelectTeam: (teamId: string) => void;
  onSetDefaultTeam: (teamId: string) => Promise<void>;
  onDeleteTeam: (teamId: string) => Promise<void>;
  createTeamDialog: React.ReactNode;
}

/**
 * Lists configured teams and lets the user choose the active detail view.
 */
export function TeamListSection({
  teams,
  selectedTeamId,
  canManage,
  onSelectTeam,
  onSetDefaultTeam,
  onDeleteTeam,
  createTeamDialog,
}: TeamListSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 py-3">
        <div>
          <CardTitle className="text-sm">Teams</CardTitle>
          <CardDescription className="text-xs">Select a team to configure.</CardDescription>
        </div>
        {canManage ? createTeamDialog : null}
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        {teams.length === 0 ? (
          <div className="border border-dashed p-4 text-sm text-muted-foreground">
            No teams configured yet. Create one to get started.
          </div>
        ) : null}

        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            className={`w-full border p-3 text-left transition group ${
              team.id === selectedTeamId
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/40"
            }`}
            onClick={() => onSelectTeam(team.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium truncate">{team.name}</p>
                  {team.isDefault ? (
                    <Badge variant="secondary" className="text-[0.6rem] px-1.5 py-0 shrink-0">
                      Default
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {team.roles.length} roles &middot; {team.edges.length} connections
                </p>
              </div>

              {canManage ? (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {!team.isDefault ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[0.6rem] px-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onSetDefaultTeam(team.id);
                      }}
                    >
                      Set default
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDeleteTeam(team.id);
                    }}
                  >
                    <RiDeleteBinLine className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ) : null}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

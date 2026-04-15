"use client";

import { AddEdgeDialog } from "@/components/settings/agent-team/add-edge-dialog";
import { AddRoleDialog } from "@/components/settings/agent-team/add-role-dialog";
import {
  ALL_ROLE_SLUGS,
  ROLE_DEFAULT_TOOLS,
  ROLE_LABELS,
  STANDARD_CONNECTIONS,
  getRoleVisual,
} from "@/components/settings/agent-team/role-metadata";
import { TeamGraphView } from "@/components/settings/agent-team/team-graph-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiArrowRightSLine, RiDeleteBinLine, RiFlashlightLine } from "@remixicon/react";
import {
  AGENT_PROVIDER,
  type AddAgentTeamEdgeInput,
  type AddAgentTeamRoleInput,
  type AgentTeam,
  type AgentTeamRoleSlug,
} from "@shared/types";
import { useCallback, useMemo, useRef, useState } from "react";

interface TeamDetailSectionProps {
  team: AgentTeam | null;
  canManage: boolean;
  onAddRole: (input: AddAgentTeamRoleInput) => Promise<void>;
  onRemoveRole: (roleId: string) => Promise<void>;
  onAddEdge: (input: AddAgentTeamEdgeInput) => Promise<void>;
  onRemoveEdge: (edgeId: string) => Promise<void>;
}

/**
 * Shows the selected team as an interactive graph with an agent dock
 * for quick role addition and auto-assembly.
 */
export function TeamDetailSection({
  team,
  canManage,
  onAddRole,
  onRemoveRole,
  onAddEdge,
  onRemoveEdge,
}: TeamDetailSectionProps) {
  const addRoleRef = useRef<HTMLButtonElement>(null);
  const addEdgeRef = useRef<HTMLButtonElement>(null);
  const [isAssembling, setIsAssembling] = useState(false);

  const existingSlugs = useMemo(() => {
    if (!team) return new Set<AgentTeamRoleSlug>();
    return new Set(team.roles.map((r) => r.slug));
  }, [team]);

  const missingSlugs = useMemo(
    () => ALL_ROLE_SLUGS.filter((slug) => !existingSlugs.has(slug)),
    [existingSlugs]
  );

  const addSingleRole = useCallback(
    async (slug: AgentTeamRoleSlug) => {
      if (!team) return;
      const tools = ROLE_DEFAULT_TOOLS[slug];
      await onAddRole({
        teamId: team.id,
        slug,
        label: ROLE_LABELS[slug],
        provider: AGENT_PROVIDER.openai,
        toolIds: tools ?? [],
        maxSteps: 8,
      });
    },
    [team, onAddRole]
  );

  const autoAssemble = useCallback(async () => {
    if (!team || isAssembling) return;
    setIsAssembling(true);

    try {
      for (const slug of missingSlugs) {
        await addSingleRole(slug);
      }

      // Small delay to let state refresh after roles are created, then
      // we need fresh role IDs to create edges.  The hook refetches after
      // each addRole, so at this point the team data may be stale.  We
      // skip edge creation here and let the user add connections via the
      // dialog since we'd need the refreshed role IDs.
      //
      // In practice, a dedicated "assembleTeam" backend endpoint would be
      // better.  For now, adding all roles is the main value.
    } finally {
      setIsAssembling(false);
    }
  }, [team, isAssembling, missingSlugs, addSingleRole]);

  if (!team) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team details</CardTitle>
          <p className="text-sm text-muted-foreground">
            Select a team to inspect or edit its configuration.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Team header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{team.name}</h2>
            {team.isDefault ? <Badge variant="secondary">Default</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {team.description || "No description provided."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{team.roles.length} roles</span>
          <span className="text-border">|</span>
          <span>{team.edges.length} connections</span>
        </div>
      </div>

      {/* Visual graph */}
      <TeamGraphView
        team={team}
        canManage={canManage}
        onRemoveRole={onRemoveRole}
        onRemoveEdge={onRemoveEdge}
        onOpenAddRole={() => addRoleRef.current?.click()}
        onOpenAddEdge={() => addEdgeRef.current?.click()}
      />

      {/* Agent dock — shows available roles to add */}
      {canManage && missingSlugs.length > 0 ? (
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium">
              Available Agents
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[0.65rem]"
              disabled={isAssembling}
              onClick={() => void autoAssemble()}
            >
              <RiFlashlightLine className="w-3 h-3 mr-1" />
              {isAssembling ? "Assembling..." : "Auto-Assemble Team"}
            </Button>
          </div>
          <div className="flex gap-2 p-3 overflow-x-auto">
            {missingSlugs.map((slug) => {
              const visual = getRoleVisual(slug);
              const Icon = visual.icon;
              return (
                <button
                  key={slug}
                  type="button"
                  className="shrink-0 w-44 border border-border bg-background p-3 text-left transition-colors hover:border-primary/50 group"
                  onClick={() => void addSingleRole(slug)}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="flex items-center justify-center w-5 h-5 rounded-full"
                      style={{ backgroundColor: `${visual.color}1a`, color: visual.color }}
                    >
                      <Icon className="w-3 h-3" />
                    </div>
                    <span className="text-xs font-medium uppercase">{ROLE_LABELS[slug]}</span>
                  </div>
                  <p className="text-[0.6rem] italic mb-1" style={{ color: `${visual.color}aa` }}>
                    {visual.archetype}
                  </p>
                  <p className="text-[0.55rem] text-muted-foreground leading-relaxed line-clamp-2">
                    {visual.flavorText}
                  </p>
                  <p className="text-[0.55rem] text-muted-foreground mt-1.5 group-hover:text-foreground transition-colors">
                    Click to add
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Hidden dialog triggers (opened by graph floating buttons) */}
      <div className="hidden">
        <AddRoleDialog teamId={team.id} onAddRole={onAddRole} triggerRef={addRoleRef} />
        <AddEdgeDialog team={team} onAddEdge={onAddEdge} triggerRef={addEdgeRef} />
      </div>

      {/* Compact roles table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 py-3">
          <CardTitle className="text-sm">Roles</CardTitle>
          {canManage ? <AddRoleDialog teamId={team.id} onAddRole={onAddRole} /> : null}
        </CardHeader>
        {team.roles.length > 0 ? (
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {team.roles.map((role) => {
                const visual = getRoleVisual(role.slug);
                const Icon = visual.icon;

                return (
                  <div key={role.id} className="flex items-center gap-3 px-4 py-2.5 text-sm group">
                    <div
                      className="flex items-center justify-center w-6 h-6 rounded-full shrink-0"
                      style={{
                        backgroundColor: `${visual.color}1a`,
                        color: visual.color,
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{role.label}</span>
                        <Badge variant="outline" className="text-[0.6rem] px-1.5 py-0 shrink-0">
                          {role.slug}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {role.model ? (
                        <Badge variant="secondary" className="text-[0.6rem]">
                          {role.model}
                        </Badge>
                      ) : null}
                      {role.toolIds.map((toolId) => (
                        <Badge key={toolId} variant="outline" className="text-[0.6rem]">
                          {toolId}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground ml-1">
                        {role.maxSteps} steps
                      </span>
                    </div>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={() => void onRemoveRole(role.id)}
                      >
                        <RiDeleteBinLine className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground border border-dashed p-3">
              No roles yet. Use the dock above or click &quot;Add role&quot; to get started.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Compact connections table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 py-3">
          <CardTitle className="text-sm">Connections</CardTitle>
          {canManage ? <AddEdgeDialog team={team} onAddEdge={onAddEdge} /> : null}
        </CardHeader>
        {team.edges.length > 0 ? (
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {team.edges.map((edge) => {
                const sourceRole = team.roles.find((r) => r.id === edge.sourceRoleId);
                const targetRole = team.roles.find((r) => r.id === edge.targetRoleId);
                const sourceVisual = sourceRole ? getRoleVisual(sourceRole.slug) : null;
                const targetVisual = targetRole ? getRoleVisual(targetRole.slug) : null;

                return (
                  <div key={edge.id} className="flex items-center gap-2 px-4 py-2.5 text-sm group">
                    {sourceVisual ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: sourceVisual.color }}
                        />
                        <span className="font-medium">
                          {sourceRole?.label ?? edge.sourceRoleId}
                        </span>
                      </span>
                    ) : (
                      <span>{edge.sourceRoleId}</span>
                    )}

                    <RiArrowRightSLine className="w-4 h-4 text-muted-foreground shrink-0" />

                    {targetVisual ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: targetVisual.color }}
                        />
                        <span className="font-medium">
                          {targetRole?.label ?? edge.targetRoleId}
                        </span>
                      </span>
                    ) : (
                      <span>{edge.targetRoleId}</span>
                    )}

                    <span className="flex-1" />

                    <span className="text-xs text-muted-foreground">can message</span>

                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={() => void onRemoveEdge(edge.id)}
                      >
                        <RiDeleteBinLine className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground border border-dashed p-3">
              No connections yet. Connect roles to enable communication between agents.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

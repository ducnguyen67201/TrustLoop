"use client";

import { AddEdgeDialog } from "@/components/settings/agent-team/add-edge-dialog";
import { AddRoleDialog } from "@/components/settings/agent-team/add-role-dialog";
import {
  ALL_ROLE_SLUGS,
  ROLE_DEFAULT_TOOLS,
  ROLE_LABELS,
  getRoleVisual,
} from "@/components/settings/agent-team/role-metadata";
import { TeamGraphView } from "@/components/settings/agent-team/team-graph-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiFlashlightLine } from "@remixicon/react";
import {
  AGENT_PROVIDER,
  type AddAgentTeamEdgeInput,
  type AddAgentTeamRoleInput,
  type AgentTeam,
  type AgentTeamRoleSlug,
  type UpdateAgentTeamLayoutInput,
} from "@shared/types";
import { useCallback, useMemo, useRef, useState } from "react";

interface TeamDetailSectionProps {
  team: AgentTeam | null;
  canManage: boolean;
  onAddRole: (input: AddAgentTeamRoleInput) => Promise<void>;
  onRemoveRole: (roleId: string) => Promise<void>;
  onAddEdge: (input: AddAgentTeamEdgeInput) => Promise<AgentTeam>;
  onRemoveEdge: (edgeId: string) => Promise<AgentTeam>;
  onUpdateLayout: (input: UpdateAgentTeamLayoutInput) => Promise<AgentTeam>;
  onReloadTeam: (teamId: string) => Promise<AgentTeam>;
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
  onUpdateLayout,
  onReloadTeam,
}: TeamDetailSectionProps) {
  const addRoleRef = useRef<HTMLButtonElement>(null);
  const [isAssembling, setIsAssembling] = useState(false);

  const existingSlugCounts = useMemo(() => {
    const counts = new Map<AgentTeamRoleSlug, number>();
    if (!team) {
      return counts;
    }

    for (const role of team.roles) {
      counts.set(role.slug, (counts.get(role.slug) ?? 0) + 1);
    }

    return counts;
  }, [team]);

  const missingSlugs = useMemo(
    () => ALL_ROLE_SLUGS.filter((slug) => !existingSlugCounts.has(slug)),
    [existingSlugCounts]
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
      {/* Team header — one row of stats, no fake dividers */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{team.name}</h2>
            {team.isDefault ? <Badge variant="secondary">Default</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {team.description || "No description provided."}
          </p>
        </div>
        <dl className="flex shrink-0 items-center gap-5 text-xs text-muted-foreground">
          <div className="flex flex-col">
            <dt className="uppercase tracking-wide">Roles</dt>
            <dd className="text-base font-medium tabular-nums text-foreground">
              {team.roles.length}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="uppercase tracking-wide">Connections</dt>
            <dd className="text-base font-medium tabular-nums text-foreground">
              {team.edges.length}
            </dd>
          </div>
        </dl>
      </div>

      {/* Graph is the workbench — primary interaction surface */}
      <TeamGraphView
        team={team}
        canManage={canManage}
        onAddEdge={onAddEdge}
        onRemoveRole={onRemoveRole}
        onRemoveEdge={onRemoveEdge}
        onUpdateLayout={onUpdateLayout}
        onReloadTeam={onReloadTeam}
        onOpenAddRole={() => addRoleRef.current?.click()}
      />

      {/* Compact action rail: quick-add agents + fallback connection dialog */}
      {canManage ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 py-3">
            <div>
              <CardTitle className="text-sm">
                {missingSlugs.length > 0 ? "Add an agent" : "Roster complete"}
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {missingSlugs.length > 0
                  ? `${missingSlugs.length} default role type${missingSlugs.length === 1 ? "" : "s"} still missing · you can also add duplicate specialists`
                  : "Full default roster assembled · you can still add duplicate specialists and customize labels"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {missingSlugs.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isAssembling}
                  onClick={() => void autoAssemble()}
                >
                  <RiFlashlightLine className="mr-1.5 size-3.5" />
                  {isAssembling ? "Assembling…" : "Auto-assemble"}
                </Button>
              ) : null}
              <AddEdgeDialog team={team} onAddEdge={onAddEdge} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pb-4">
            {ALL_ROLE_SLUGS.map((slug) => {
              const visual = getRoleVisual(slug);
              const Icon = visual.icon;
              const accent = `color-mix(in oklch, ${visual.color} 14%, transparent)`;
              const existingCount = existingSlugCounts.get(slug) ?? 0;
              return (
                <button
                  key={slug}
                  type="button"
                  className="group inline-flex items-center gap-2 border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:border-foreground/40"
                  onClick={() => void addSingleRole(slug)}
                  title={visual.flavorText}
                >
                  <span
                    className="flex size-5 items-center justify-center"
                    style={{ backgroundColor: accent, color: visual.color }}
                  >
                    <Icon className="size-3" />
                  </span>
                  <span className="font-medium">{ROLE_LABELS[slug]}</span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground">
                    {existingCount === 0 ? "+ Add" : `+ Add another (${existingCount})`}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* Hidden dialog trigger driven by graph toolbar */}
      <div className="hidden">
        <AddRoleDialog teamId={team.id} onAddRole={onAddRole} triggerRef={addRoleRef} />
      </div>
    </div>
  );
}

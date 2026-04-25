"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRoleVisual } from "@/lib/agent-team/role-metadata";
import { RiDeleteBinLine, RiStarLine } from "@remixicon/react";
import { AGENT_TEAM_ROLE_SLUG, type AgentTeamRole } from "@shared/types";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

export interface TeamGraphRoleNodeData extends Record<string, unknown> {
  role: AgentTeamRole;
  canManage: boolean;
  onRemoveRole: (roleId: string) => void;
}

export type TeamGraphRoleNodeType = Node<TeamGraphRoleNodeData, "role">;

/**
 * Compact operational card used as the React Flow node renderer for agent-team roles.
 */
export function TeamGraphRoleNode({ data, selected }: NodeProps<TeamGraphRoleNodeType>) {
  const visual = getRoleVisual(data.role.slug);
  const Icon = visual.icon;
  const isHub = data.role.slug === AGENT_TEAM_ROLE_SLUG.architect;

  const accentTint = `color-mix(in oklch, ${visual.color} 14%, transparent)`;
  const mutedAccent = `color-mix(in oklch, ${visual.color} 70%, var(--muted-foreground))`;
  const description = data.role.description ?? visual.flavorText;

  return (
    <div
      className="group relative min-w-60 border bg-card text-card-foreground shadow-sm transition-colors"
      style={{
        borderColor: selected ? visual.color : "var(--border)",
        boxShadow: selected ? `0 0 0 1px ${visual.color} inset` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!-top-1.5 !h-3 !w-3 !rounded-none !border-2 !border-card"
        style={{ backgroundColor: visual.color }}
        isConnectable={data.canManage}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!-bottom-1.5 !h-3 !w-3 !rounded-none !border-2 !border-card"
        style={{ backgroundColor: visual.color }}
        isConnectable={data.canManage}
      />

      <div className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: visual.color }} />

      <div className="team-graph-node__drag-handle flex cursor-grab items-start gap-3 p-3 active:cursor-grabbing">
        <div
          className="flex size-8 shrink-0 items-center justify-center"
          style={{ backgroundColor: accentTint, color: visual.color }}
        >
          <Icon className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{data.role.label}</span>
            {isHub ? (
              <Badge
                variant="outline"
                className="ml-auto rounded-none px-1.5 py-0 text-[0.65rem]"
                style={{ borderColor: mutedAccent, color: visual.color }}
              >
                <RiStarLine className="mr-0.5 size-3" />
                Hub
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs" style={{ color: mutedAccent }}>
            {visual.archetype}
          </p>
        </div>
      </div>

      <p className="line-clamp-2 px-3 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[0.7rem] text-muted-foreground">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {data.role.model ? (
            <Badge variant="secondary" className="rounded-none px-1.5 py-0 text-[0.65rem]">
              {data.role.model}
            </Badge>
          ) : null}
          {data.role.toolIds.slice(0, 2).map((toolId) => (
            <Badge
              key={toolId}
              variant="outline"
              className="rounded-none px-1.5 py-0 text-[0.65rem]"
            >
              {toolId}
            </Badge>
          ))}
          {data.role.toolIds.length > 2 ? (
            <span className="text-[0.65rem]">+{data.role.toolIds.length - 2}</span>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums">{data.role.maxSteps} steps</span>
        {data.canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="nodrag nopan shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => data.onRemoveRole(data.role.id)}
          >
            <RiDeleteBinLine className="size-3 text-destructive" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { getRoleVisual } from "@/components/settings/agent-team/role-metadata";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return (
    <div
      className="group relative min-w-56 border bg-card p-3 text-card-foreground shadow-sm transition-colors"
      style={{
        borderColor: selected ? visual.color : "hsl(var(--border))",
        boxShadow: selected ? `0 0 0 1px ${visual.color} inset` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3.5 !w-3.5 !rounded-none !border-2 !border-card !bg-muted-foreground"
        isConnectable={data.canManage}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3.5 !w-3.5 !rounded-none !border-2 !border-card !bg-muted-foreground"
        isConnectable={data.canManage}
      />

      <div className="absolute inset-x-0 top-0 h-px" style={{ backgroundColor: visual.color }} />

      <div className="team-graph-node__drag-handle flex cursor-grab items-start gap-2 active:cursor-grabbing">
        <div
          className="flex size-7 items-center justify-center rounded-none"
          style={{
            backgroundColor: `${visual.color}1a`,
            color: visual.color,
          }}
        >
          <Icon className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{data.role.label}</span>
            {isHub ? (
              <Badge
                variant="outline"
                className="ml-auto rounded-none px-1.5 py-0 text-[0.6rem]"
                style={{ borderColor: `${visual.color}66`, color: visual.color }}
              >
                <RiStarLine className="mr-0.5 size-3" />
                HUB
              </Badge>
            ) : null}
          </div>

          <p className="mt-0.5 text-[0.65rem] italic" style={{ color: `${visual.color}cc` }}>
            {visual.archetype}
          </p>
        </div>
      </div>

      {data.role.description ? (
        <p className="mt-2 line-clamp-2 text-[0.65rem] leading-relaxed text-muted-foreground">
          {data.role.description}
        </p>
      ) : (
        <p className="mt-2 line-clamp-2 text-[0.65rem] leading-relaxed text-muted-foreground">
          {visual.flavorText}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {data.role.model ? (
          <Badge variant="secondary" className="rounded-none px-1.5 py-0 text-[0.55rem]">
            {data.role.model}
          </Badge>
        ) : null}
        {data.role.toolIds.map((toolId) => (
          <Badge key={toolId} variant="outline" className="rounded-none px-1.5 py-0 text-[0.55rem]">
            {toolId}
          </Badge>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-[0.6rem] text-muted-foreground">
        <span>{data.role.maxSteps} steps</span>
        {data.canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="nodrag nopan opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => data.onRemoveRole(data.role.id)}
          >
            <RiDeleteBinLine className="size-3 text-destructive" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

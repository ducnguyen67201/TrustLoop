"use client";

import {
  buildInitialNodePositions,
  computeAutoLayout,
} from "@/components/settings/agent-team/team-graph-layout";
import {
  TeamGraphRoleNode,
  type TeamGraphRoleNodeData,
  type TeamGraphRoleNodeType,
} from "@/components/settings/agent-team/team-graph-role-node";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AgentTeamLayoutConflictError } from "@/hooks/use-agent-teams";
import {
  RiAlertLine,
  RiLayoutGridLine,
  RiLoader4Line,
  RiLockLine,
  RiRefreshLine,
} from "@remixicon/react";
import type { AgentTeam, UpdateAgentTeamLayoutInput } from "@shared/types";
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type NodeTypes,
  Position,
  ReactFlow,
  addEdge as addFlowEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface TeamGraphViewProps {
  team: AgentTeam;
  canManage: boolean;
  onAddEdge: (input: {
    teamId: string;
    sourceRoleId: string;
    targetRoleId: string;
  }) => Promise<AgentTeam>;
  onRemoveRole: (roleId: string) => Promise<void>;
  onRemoveEdge: (edgeId: string) => Promise<AgentTeam>;
  onUpdateLayout: (input: UpdateAgentTeamLayoutInput) => Promise<AgentTeam>;
  onReloadTeam: (teamId: string) => Promise<AgentTeam>;
  onOpenAddRole: () => void;
}

type GraphStatus =
  | { tone: "neutral"; title: string; description: string }
  | { tone: "destructive"; title: string; description: string }
  | null;

const nodeTypes: NodeTypes = {
  role: TeamGraphRoleNode,
};

const defaultEdgeStyle = {
  stroke: "hsl(var(--muted-foreground))",
  strokeWidth: 1.5,
};

function buildFlowNodes(
  team: AgentTeam,
  onRemoveRole: (roleId: string) => void
): TeamGraphRoleNodeType[] {
  const positions = buildInitialNodePositions(team);

  return team.roles.map((role) => ({
    id: role.id,
    type: "role",
    position: positions.get(role.id) ?? { x: 0, y: 0 },
    dragHandle: ".team-graph-node__drag-handle",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      role,
      canManage: true,
      onRemoveRole,
    },
  }));
}

function buildFlowEdges(team: AgentTeam): Edge[] {
  return team.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceRoleId,
    target: edge.targetRoleId,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "hsl(var(--muted-foreground))",
    },
    style: defaultEdgeStyle,
  }));
}

function serializeNodePositions(nodes: TeamGraphRoleNodeType[]) {
  return nodes.map((node) => ({
    roleId: node.id,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
  }));
}

function buildConflictStatus(): GraphStatus {
  return {
    tone: "destructive",
    title: "Layout changed elsewhere",
    description: "Reload positions or try saving your current draft again.",
  };
}

function buildMutationError(error: unknown, fallback: string): GraphStatus {
  if (error instanceof Error) {
    return {
      tone: "destructive",
      title: "Action failed",
      description: error.message,
    };
  }

  return {
    tone: "destructive",
    title: "Action failed",
    description: fallback,
  };
}

/**
 * React Flow-based graph editor for agent-team settings.
 */
export function TeamGraphView({
  team,
  canManage,
  onAddEdge,
  onRemoveRole,
  onRemoveEdge,
  onUpdateLayout,
  onReloadTeam,
  onOpenAddRole,
}: TeamGraphViewProps) {
  const [status, setStatus] = useState<GraphStatus>(null);
  const [conflictTeam, setConflictTeam] = useState<AgentTeam | null>(null);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<TeamGraphRoleNodeType>(
    buildFlowNodes(team, (roleId) => {
      void onRemoveRole(roleId).catch((error) => {
        setStatus(buildMutationError(error, "Failed to remove role."));
      });
    })
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildFlowEdges(team));
  const latestTeamRef = useRef(team);

  useEffect(() => {
    latestTeamRef.current = team;
  }, [team]);

  useEffect(() => {
    if (hasLocalDraft) {
      return;
    }

    setNodes(
      buildFlowNodes(team, (roleId) => {
        void onRemoveRole(roleId).catch((error) => {
          setStatus(buildMutationError(error, "Failed to remove role."));
        });
      })
    );
    setEdges(buildFlowEdges(team));
  }, [team, hasLocalDraft, onRemoveRole, setEdges, setNodes]);

  const showMiniMap = team.roles.length >= 8;
  const isEmpty = team.roles.length === 0;
  const conflictActionsVisible = conflictTeam !== null;
  const defaultStatus =
    !status && !canManage
      ? {
          tone: "neutral" as const,
          title: "Read only",
          description: "You can inspect the graph, but only owners and admins can change it.",
        }
      : status;

  const saveLayout = useCallback(
    async (nextNodes: TeamGraphRoleNodeType[], expectedUpdatedAt: string) => {
      if (!canManage || nextNodes.length === 0) {
        return;
      }

      setStatus({
        tone: "neutral",
        title: "Saving layout",
        description: "Persisting role positions in the selected team.",
      });

      try {
        await onUpdateLayout({
          teamId: team.id,
          expectedUpdatedAt,
          positions: serializeNodePositions(nextNodes),
        });
        setHasLocalDraft(false);
        setConflictTeam(null);
        setStatus(null);
      } catch (error) {
        if (error instanceof AgentTeamLayoutConflictError) {
          setConflictTeam(error.latestTeam);
          setStatus(buildConflictStatus());
          return;
        }

        setStatus(buildMutationError(error, "Failed to save team layout."));
      }
    },
    [canManage, onUpdateLayout, team.id]
  );

  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!canManage || !connection.source || !connection.target) {
        return;
      }

      const edgeExists = edges.some(
        (edge) => edge.source === connection.source && edge.target === connection.target
      );
      if (edgeExists) {
        setStatus({
          tone: "destructive",
          title: "Connection blocked",
          description: "These roles are already connected.",
        });
        return;
      }

      const optimisticEdge: Edge = {
        id: `pending:${connection.source}:${connection.target}`,
        source: connection.source,
        target: connection.target,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "hsl(var(--muted-foreground))",
        },
        style: defaultEdgeStyle,
      };

      setStatus({
        tone: "neutral",
        title: "Connecting roles",
        description: "Creating a directed handoff between these agents.",
      });
      setEdges((currentEdges) => addFlowEdge(optimisticEdge, currentEdges));

      try {
        const updatedTeam = await onAddEdge({
          teamId: team.id,
          sourceRoleId: connection.source,
          targetRoleId: connection.target,
        });
        setEdges(buildFlowEdges(updatedTeam));
        setStatus(null);
      } catch (error) {
        setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== optimisticEdge.id));

        if (error instanceof Error && error.message.includes("cycle")) {
          setStatus({
            tone: "destructive",
            title: "Connection blocked",
            description: "Can't connect these roles. This would create a cycle.",
          });
          return;
        }

        if (error instanceof Error && error.message.includes("already exists")) {
          setStatus({
            tone: "destructive",
            title: "Connection blocked",
            description: "These roles are already connected.",
          });
          return;
        }

        setStatus(buildMutationError(error, "Failed to add connection."));
      }
    },
    [canManage, edges, onAddEdge, setEdges, team.id]
  );

  const handleNodeDragStop = useCallback(
    async (
      _event: unknown,
      nextNode: TeamGraphRoleNodeType,
      nextNodes: TeamGraphRoleNodeType[]
    ) => {
      if (!canManage) {
        return;
      }

      const updatedNodes = nextNodes.map((node) =>
        node.id === nextNode.id ? { ...node, position: nextNode.position } : node
      );
      setHasLocalDraft(true);
      setNodes(updatedNodes);
      await saveLayout(updatedNodes, conflictTeam?.updatedAt ?? latestTeamRef.current.updatedAt);
    },
    [canManage, conflictTeam?.updatedAt, saveLayout, setNodes]
  );

  const handleNodesDelete = useCallback(
    async (deletedNodes: TeamGraphRoleNodeType[]) => {
      if (!canManage || deletedNodes.length === 0) {
        return;
      }

      try {
        await Promise.all(deletedNodes.map((node) => onRemoveRole(node.id)));
      } catch (error) {
        setStatus(buildMutationError(error, "Failed to remove one or more roles."));
      }
    },
    [canManage, onRemoveRole]
  );

  const handleEdgesDelete = useCallback(
    async (deletedEdges: Edge[]) => {
      if (!canManage || deletedEdges.length === 0) {
        return;
      }

      try {
        await Promise.all(deletedEdges.map((edge) => onRemoveEdge(edge.id)));
      } catch (error) {
        setStatus(buildMutationError(error, "Failed to remove one or more connections."));
      }
    },
    [canManage, onRemoveEdge]
  );

  const handleAutoLayout = useCallback(async () => {
    const nextPositions = computeAutoLayout(team);
    const nextNodes = nodes.map((node) => ({
      ...node,
      position: nextPositions.get(node.id) ?? node.position,
    }));

    setHasLocalDraft(true);
    setNodes(nextNodes);
    await saveLayout(nextNodes, conflictTeam?.updatedAt ?? latestTeamRef.current.updatedAt);
  }, [conflictTeam?.updatedAt, nodes, saveLayout, setNodes, team]);

  const handleReloadLayout = useCallback(async () => {
    const latestTeam = conflictTeam ?? (await onReloadTeam(team.id));
    setNodes(
      buildFlowNodes(latestTeam, (roleId) => {
        void onRemoveRole(roleId).catch((error) => {
          setStatus(buildMutationError(error, "Failed to remove role."));
        });
      })
    );
    setEdges(buildFlowEdges(latestTeam));
    setHasLocalDraft(false);
    setConflictTeam(null);
    setStatus(null);
    if (conflictTeam) {
      await onReloadTeam(team.id);
    }
  }, [conflictTeam, onReloadTeam, onRemoveRole, setEdges, setNodes, team.id]);

  const handleRetrySave = useCallback(async () => {
    if (!conflictTeam) {
      return;
    }

    await saveLayout(nodes, conflictTeam.updatedAt);
  }, [conflictTeam, nodes, saveLayout]);

  const minimapNodeColor = useCallback((node: TeamGraphRoleNodeType) => {
    return node.selected ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";
  }, []);

  const toolbar = useMemo(
    () => (
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
        {canManage ? (
          <Button size="sm" onClick={onOpenAddRole}>
            Add role
          </Button>
        ) : null}
        {canManage && team.roles.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => void handleAutoLayout()}>
            <RiLayoutGridLine className="mr-1.5 size-3.5" />
            Auto-layout
          </Button>
        ) : null}
        {!canManage ? (
          <div className="inline-flex items-center gap-1 border border-border bg-card px-2 py-1 text-[0.65rem] text-muted-foreground">
            <RiLockLine className="size-3" />
            Read only
          </div>
        ) : null}
      </div>
    ),
    [canManage, handleAutoLayout, onOpenAddRole, team.roles.length]
  );

  return (
    <div
      className="relative h-[clamp(380px,50vh,560px)] w-full overflow-hidden border border-border bg-card"
      data-testid="agent-team-graph"
    >
      {toolbar}

      {defaultStatus ? (
        <div className="absolute inset-x-3 top-12 z-20">
          <Alert variant={defaultStatus.tone === "destructive" ? "destructive" : "default"}>
            <RiAlertLine />
            <AlertTitle>{defaultStatus.title}</AlertTitle>
            <AlertDescription>{defaultStatus.description}</AlertDescription>
            {conflictActionsVisible ? (
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="xs" onClick={() => void handleReloadLayout()}>
                  <RiRefreshLine className="mr-1 size-3" />
                  Reload layout
                </Button>
                <Button size="xs" onClick={() => void handleRetrySave()}>
                  Try save again
                </Button>
              </div>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <ReactFlow<TeamGraphRoleNodeType, Edge>
        nodes={nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            canManage,
          },
        }))}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(connection) => {
          void handleConnect(connection);
        }}
        onNodeDragStop={(event, node, currentNodes) => {
          void handleNodeDragStop(event, node, currentNodes);
        }}
        onNodesDelete={(deletedNodes) => {
          void handleNodesDelete(deletedNodes);
        }}
        onEdgesDelete={(deletedEdges) => {
          void handleEdgesDelete(deletedEdges);
        }}
        nodesDraggable={canManage}
        nodesConnectable={canManage}
        elementsSelectable
        connectionMode={ConnectionMode.Strict}
        connectionRadius={24}
        deleteKeyCode={canManage ? ["Backspace", "Delete"] : null}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.5}
        maxZoom={1.5}
        className="bg-dot-grid"
        connectionLineStyle={defaultEdgeStyle}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: defaultEdgeStyle,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "hsl(var(--muted-foreground))",
          },
        }}
      >
        <Background
          color="color-mix(in oklch, var(--border) 85%, var(--foreground))"
          gap={24}
          size={1}
        />
        <Controls showInteractive={false} position="bottom-left" />
        {showMiniMap ? (
          <MiniMap
            position="top-right"
            pannable
            zoomable
            nodeColor={minimapNodeColor}
            className="!rounded-none !border !border-border !bg-card"
          />
        ) : null}
      </ReactFlow>

      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="border border-dashed border-border bg-card px-5 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              Add your first role to build the team graph.
            </p>
            {canManage ? (
              <Button className="pointer-events-auto mt-3" size="sm" onClick={onOpenAddRole}>
                Add role
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {defaultStatus?.title === "Saving layout" ? (
        <div className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-[0.65rem] text-muted-foreground">
          <RiLoader4Line className="size-3 animate-spin" />
          Saving layout…
        </div>
      ) : null}
    </div>
  );
}

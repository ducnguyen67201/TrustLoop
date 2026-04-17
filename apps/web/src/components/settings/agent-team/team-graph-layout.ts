"use client";

import dagre from "@dagrejs/dagre";
import type { AgentTeam, AgentTeamRole, AgentTeamRoleMetadata } from "@shared/types";
import type { XYPosition } from "@xyflow/react";

// Match the rendered card footprint — `min-w-60` (240px) plus a little slack so
// dagre leaves breathing room around wider content.
export const TEAM_GRAPH_NODE_WIDTH = 260;
export const TEAM_GRAPH_NODE_HEIGHT = 148;

export function getRoleCanvasPosition(role: AgentTeamRole): XYPosition | null {
  const position = role.metadata?.canvas?.position;
  if (!position) {
    return null;
  }

  return {
    x: position.x,
    y: position.y,
  };
}

export function buildRoleMetadataWithPosition(
  metadata: AgentTeamRoleMetadata | null | undefined,
  position: XYPosition
): AgentTeamRoleMetadata {
  return {
    ...(metadata ?? {}),
    canvas: {
      ...(metadata?.canvas ?? {}),
      position: {
        x: position.x,
        y: position.y,
      },
    },
  };
}

export function hasStoredLayout(team: AgentTeam): boolean {
  return team.roles.every((role) => getRoleCanvasPosition(role) !== null);
}

export function computeAutoLayout(team: AgentTeam): Map<string, XYPosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  // Top-down tree: hub/root fans out to siblings at each rank, matching the
  // reference tree layout. Generous spacing keeps cards from colliding with
  // each other or with the edge fan-out between ranks.
  graph.setGraph({
    rankdir: "TB",
    align: "UL",
    nodesep: 72,
    ranksep: 110,
    marginx: 48,
    marginy: 48,
  });

  for (const role of team.roles) {
    graph.setNode(role.id, {
      width: TEAM_GRAPH_NODE_WIDTH,
      height: TEAM_GRAPH_NODE_HEIGHT,
    });
  }

  for (const edge of team.edges) {
    graph.setEdge(edge.sourceRoleId, edge.targetRoleId);
  }

  dagre.layout(graph);

  const positions = new Map<string, XYPosition>();
  for (const role of team.roles) {
    const node = graph.node(role.id);
    if (!node) {
      continue;
    }

    positions.set(role.id, {
      x: node.x - TEAM_GRAPH_NODE_WIDTH / 2,
      y: node.y - TEAM_GRAPH_NODE_HEIGHT / 2,
    });
  }

  return positions;
}

export function buildInitialNodePositions(team: AgentTeam): Map<string, XYPosition> {
  if (hasStoredLayout(team)) {
    return new Map(
      team.roles.flatMap((role) => {
        const position = getRoleCanvasPosition(role);
        return position ? [[role.id, position] as const] : [];
      })
    );
  }

  return computeAutoLayout(team);
}

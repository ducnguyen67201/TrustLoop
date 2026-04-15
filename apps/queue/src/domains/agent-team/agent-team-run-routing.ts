import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TARGET,
  type AgentTeamDialogueMessageDraft,
  type AgentTeamMessageKind,
  type AgentTeamRole,
  type AgentTeamRoleSlug,
  type AgentTeamSnapshot,
  canRouteTo,
  isRoleTarget,
} from "@shared/types";

export const MAX_AGENT_TEAM_MESSAGES = 40;
export const MAX_AGENT_TEAM_TURNS = 20;
export const MAX_ROLE_TURNS = 8;

export function selectInitialRole(snapshot: AgentTeamSnapshot): AgentTeamRole {
  const architect = snapshot.roles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.architect);
  if (architect) {
    return architect;
  }

  const [fallback] = [...snapshot.roles].sort(compareRoles);
  if (!fallback) {
    throw new Error("Agent team snapshot has no roles to schedule");
  }

  return fallback;
}

export function collectQueuedTargets(input: {
  senderRoleSlug: AgentTeamRoleSlug;
  messages: AgentTeamDialogueMessageDraft[];
  nextSuggestedRoles: AgentTeamRoleSlug[];
  hasReviewerApproval: boolean;
}): AgentTeamRoleSlug[] {
  const targets = new Set<AgentTeamRoleSlug>();

  for (const message of input.messages) {
    if (isRoleTarget(message.toRoleSlug) && shouldWakeTarget(message.kind)) {
      targets.add(message.toRoleSlug);
    }

    if (message.kind === AGENT_TEAM_MESSAGE_KIND.blocked) {
      targets.add(AGENT_TEAM_ROLE_SLUG.architect);
    }

    if (message.kind === AGENT_TEAM_MESSAGE_KIND.approval) {
      targets.add(AGENT_TEAM_ROLE_SLUG.prCreator);
    }
  }

  for (const nextRole of input.nextSuggestedRoles) {
    targets.add(nextRole);
  }

  if (!input.hasReviewerApproval) {
    targets.delete(AGENT_TEAM_ROLE_SLUG.prCreator);
  }

  return [...targets];
}

export function assertValidMessageRouting(input: {
  senderRoleSlug: AgentTeamRoleSlug;
  messages: AgentTeamDialogueMessageDraft[];
}): void {
  for (const message of input.messages) {
    if (!isRoleTarget(message.toRoleSlug)) {
      continue;
    }

    if (!canRouteTo(input.senderRoleSlug, message.toRoleSlug)) {
      throw new Error(
        `Role ${input.senderRoleSlug} cannot address ${message.toRoleSlug} in agent-team dialogue`
      );
    }
  }
}

export function shouldCreateOpenQuestion(kind: AgentTeamMessageKind): boolean {
  return (
    kind === AGENT_TEAM_MESSAGE_KIND.question ||
    kind === AGENT_TEAM_MESSAGE_KIND.requestEvidence ||
    kind === AGENT_TEAM_MESSAGE_KIND.blocked
  );
}

export function shouldWakeTarget(kind: AgentTeamMessageKind): boolean {
  const passiveKinds: AgentTeamMessageKind[] = [
    AGENT_TEAM_MESSAGE_KIND.toolCall,
    AGENT_TEAM_MESSAGE_KIND.toolResult,
    AGENT_TEAM_MESSAGE_KIND.status,
  ];

  return !passiveKinds.includes(kind);
}

function compareRoles(left: AgentTeamRole, right: AgentTeamRole): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.slug.localeCompare(right.slug);
}

import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  type AgentTeamDialogueMessageDraft,
  type AgentTeamMessageKind,
  type AgentTeamRole,
  type AgentTeamSnapshot,
  RESOLUTION_TARGET,
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
  senderRole: AgentTeamRole;
  teamRoles: AgentTeamRole[];
  messages: AgentTeamDialogueMessageDraft[];
  nextSuggestedRoleKeys: string[];
  hasReviewerApproval: boolean;
}): string[] {
  const targets = new Set<string>();
  const rolesByKey = new Map(input.teamRoles.map((role) => [role.roleKey, role]));

  for (const message of input.messages) {
    if (isRoleTarget(message.toRoleKey) && shouldWakeTarget(message.kind)) {
      if (!rolesByKey.has(message.toRoleKey)) {
        continue;
      }
      targets.add(message.toRoleKey);
    }

    if (message.kind === AGENT_TEAM_MESSAGE_KIND.blocked) {
      for (const roleKey of listRoleKeysBySlug(input.teamRoles, AGENT_TEAM_ROLE_SLUG.architect)) {
        targets.add(roleKey);
      }
    }

    if (message.kind === AGENT_TEAM_MESSAGE_KIND.approval) {
      for (const roleKey of listRoleKeysBySlug(input.teamRoles, AGENT_TEAM_ROLE_SLUG.prCreator)) {
        targets.add(roleKey);
      }
    }
  }

  for (const nextRole of input.nextSuggestedRoleKeys) {
    const targetRole = rolesByKey.get(nextRole);
    if (!targetRole || !canRouteTo(input.senderRole.slug, targetRole.slug)) {
      continue;
    }
    targets.add(nextRole);
  }

  if (!input.hasReviewerApproval) {
    for (const roleKey of listRoleKeysBySlug(input.teamRoles, AGENT_TEAM_ROLE_SLUG.prCreator)) {
      targets.delete(roleKey);
    }
  }

  return [...targets];
}

export function assertValidMessageRouting(input: {
  senderRole: AgentTeamRole;
  teamRoles: AgentTeamRole[];
  messages: AgentTeamDialogueMessageDraft[];
}): void {
  const rolesByKey = new Map(input.teamRoles.map((role) => [role.roleKey, role]));

  for (const message of input.messages) {
    if (!isRoleTarget(message.toRoleKey)) {
      continue;
    }

    const targetRole = rolesByKey.get(message.toRoleKey);
    if (!targetRole) {
      if (isHumanResolutionTarget(message.toRoleKey)) {
        continue;
      }

      throw new Error(
        `Role ${input.senderRole.roleKey} cannot address unknown target ${message.toRoleKey}`
      );
    }

    if (!canRouteTo(input.senderRole.slug, targetRole.slug)) {
      throw new Error(
        `Role ${input.senderRole.roleKey} cannot address ${message.toRoleKey} in agent-team dialogue`
      );
    }
  }
}

export interface DroppedMessage {
  message: AgentTeamDialogueMessageDraft;
  reason: string;
}

// LLMs occasionally hallucinate `toRoleKey` values — pointing at themselves,
// at a role they're not allowed to address, or at an unknown identifier.
// Throwing on every hallucination kills the whole run on activity retry; we
// drop the offending message and let the rest of the turn proceed instead.
export function partitionMessagesByRouting(input: {
  senderRole: AgentTeamRole;
  teamRoles: AgentTeamRole[];
  messages: AgentTeamDialogueMessageDraft[];
}): { valid: AgentTeamDialogueMessageDraft[]; dropped: DroppedMessage[] } {
  const rolesByKey = new Map(input.teamRoles.map((role) => [role.roleKey, role]));
  const valid: AgentTeamDialogueMessageDraft[] = [];
  const dropped: DroppedMessage[] = [];

  for (const message of input.messages) {
    if (!isRoleTarget(message.toRoleKey)) {
      valid.push(message);
      continue;
    }

    const targetRole = rolesByKey.get(message.toRoleKey);
    if (!targetRole) {
      if (isHumanResolutionTarget(message.toRoleKey)) {
        valid.push(message);
        continue;
      }

      dropped.push({
        message,
        reason: `unknown target ${message.toRoleKey}`,
      });
      continue;
    }

    if (!canRouteTo(input.senderRole.slug, targetRole.slug)) {
      dropped.push({
        message,
        reason: `${input.senderRole.slug} cannot address ${targetRole.slug}`,
      });
      continue;
    }

    valid.push(message);
  }

  return { valid, dropped };
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

export function isHumanResolutionTarget(target: string): boolean {
  return target === RESOLUTION_TARGET.customer || target === RESOLUTION_TARGET.operator;
}

function compareRoles(left: AgentTeamRole, right: AgentTeamRole): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.slug.localeCompare(right.slug);
}

function listRoleKeysBySlug(roles: AgentTeamRole[], slug: AgentTeamRole["slug"]): string[] {
  return roles.filter((role) => role.slug === slug).map((role) => role.roleKey);
}

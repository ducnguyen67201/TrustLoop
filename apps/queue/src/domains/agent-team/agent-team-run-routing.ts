import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_INBOX_STATE,
  AGENT_TEAM_ROLE_SLUG,
  type AgentTeamDialogueMessageDraft,
  type AgentTeamMessageKind,
  type AgentTeamRole,
  type AgentTeamRoleInboxState,
  type AgentTeamRoleTurnOutput,
  type AgentTeamSnapshot,
  RESOLUTION_STATUS,
  RESOLUTION_TARGET,
  canRouteTo,
  isRoleTarget,
} from "@shared/types";

export const MAX_AGENT_TEAM_MESSAGES = 160;
export const MAX_AGENT_TEAM_TURNS = 40;
export const MAX_ROLE_TURNS = 24;

export interface MessageBudgetResult {
  messages: AgentTeamDialogueMessageDraft[];
  droppedCount: number;
  remainingCapacity: number;
}

export interface RunBudgetProgress {
  queuedInboxCount: number;
  blockedInboxCount: number;
  openQuestionCount: number;
}

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

export function selectBudgetSynthesisRole(snapshot: AgentTeamSnapshot): AgentTeamRole {
  const architect = snapshot.roles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.architect);
  if (architect) {
    return architect;
  }

  const synthesisFallbackOrder = [
    AGENT_TEAM_ROLE_SLUG.reviewer,
    AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
    AGENT_TEAM_ROLE_SLUG.codeReader,
    AGENT_TEAM_ROLE_SLUG.prCreator,
    AGENT_TEAM_ROLE_SLUG.drafter,
  ];

  for (const slug of synthesisFallbackOrder) {
    const role = snapshot.roles.find((candidate) => candidate.slug === slug);
    if (role) {
      return role;
    }
  }

  const [fallback] = [...snapshot.roles].sort(compareRoles);
  if (!fallback) {
    throw new Error("Agent team snapshot has no roles to synthesize budget findings");
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
  const hasReviewerRole = input.teamRoles.some(
    (role) => role.slug === AGENT_TEAM_ROLE_SLUG.reviewer
  );

  for (const message of input.messages) {
    if (isRoleTarget(message.toRoleKey) && shouldWakeTarget(message.kind)) {
      const targetRole = rolesByKey.get(message.toRoleKey);
      if (!targetRole) {
        continue;
      }
      if (!shouldWakeRoleForMessage(targetRole, message)) {
        continue;
      }
      targets.add(message.toRoleKey);
    }

    if (message.kind === AGENT_TEAM_MESSAGE_KIND.blocked) {
      for (const roleKey of listRoleKeysBySlug(input.teamRoles, AGENT_TEAM_ROLE_SLUG.architect)) {
        if (roleKey === input.senderRole.roleKey) {
          continue;
        }
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
    const targetRole =
      rolesByKey.get(nextRole) ??
      resolveMissingCanonicalRoleTarget({
        senderRole: input.senderRole,
        teamRoles: input.teamRoles,
        missingTarget: nextRole,
      });
    if (!targetRole || !canRouteTo(input.senderRole.slug, targetRole.slug)) {
      continue;
    }
    if (
      targetRole.slug === AGENT_TEAM_ROLE_SLUG.prCreator &&
      !hasActionablePrCreatorHandoff(input.messages, targetRole.roleKey)
    ) {
      continue;
    }
    targets.add(targetRole.roleKey);
  }

  if (hasReviewerRole && !input.hasReviewerApproval) {
    for (const roleKey of listRoleKeysBySlug(input.teamRoles, AGENT_TEAM_ROLE_SLUG.prCreator)) {
      targets.delete(roleKey);
    }
  }

  return [...targets];
}

export function normalizeRoutableMessageTargets(input: {
  senderRole: AgentTeamRole;
  teamRoles: AgentTeamRole[];
  messages: AgentTeamDialogueMessageDraft[];
}): AgentTeamDialogueMessageDraft[] {
  const rolesByKey = new Map(input.teamRoles.map((role) => [role.roleKey, role]));

  return input.messages.map((message) => {
    if (!isRoleTarget(message.toRoleKey) || rolesByKey.has(message.toRoleKey)) {
      return message;
    }

    const fallbackRole = resolveMissingCanonicalRoleTarget({
      senderRole: input.senderRole,
      teamRoles: input.teamRoles,
      missingTarget: message.toRoleKey,
    });
    return fallbackRole ? { ...message, toRoleKey: fallbackRole.roleKey } : message;
  });
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

export interface ResolveSelfTurnStateInput {
  resolution: AgentTeamRoleTurnOutput["resolution"];
  messageResolutionQuestionCount: number;
  done: boolean;
}

export interface ResolveSelfTurnStateResult {
  state: AgentTeamRoleInboxState;
  // True when the role asked to block (status=needs_input or kind=blocked
  // message) but dispatched zero customer/operator-targeted questions. With
  // no human-actionable signal the operator panel has nothing to offer, so
  // the run would loop between waiting and resume forever. Downgrade to idle
  // and log a warning so the next claimNextQueuedInbox cycle can drain.
  hallucinatedBlock: boolean;
}

export function resolveSelfTurnState(input: ResolveSelfTurnStateInput): ResolveSelfTurnStateResult {
  const isResolutionBlocked =
    input.resolution !== null &&
    input.resolution !== undefined &&
    input.resolution.status === RESOLUTION_STATUS.needsInput;
  const wantsBlock = isResolutionBlocked || input.messageResolutionQuestionCount > 0;
  const humanQuestionCount =
    (input.resolution?.questionsToResolve.filter(
      (question) =>
        question.target === RESOLUTION_TARGET.customer ||
        question.target === RESOLUTION_TARGET.operator
    ).length ?? 0) + input.messageResolutionQuestionCount;
  const hallucinatedBlock = wantsBlock && humanQuestionCount === 0;

  let state: AgentTeamRoleInboxState;
  if (wantsBlock && !hallucinatedBlock) {
    state = AGENT_TEAM_ROLE_INBOX_STATE.blocked;
  } else if (input.done) {
    state = AGENT_TEAM_ROLE_INBOX_STATE.done;
  } else {
    state = AGENT_TEAM_ROLE_INBOX_STATE.idle;
  }

  return { state, hallucinatedBlock };
}

export function hasHumanResolutionQuestion(
  input: Pick<ResolveSelfTurnStateInput, "resolution" | "messageResolutionQuestionCount">
): boolean {
  const resolutionQuestionCount =
    input.resolution?.questionsToResolve.filter(
      (question) =>
        question.target === RESOLUTION_TARGET.customer ||
        question.target === RESOLUTION_TARGET.operator
    ).length ?? 0;

  return resolutionQuestionCount + input.messageResolutionQuestionCount > 0;
}

export function filterQueuedTargetsForHumanInput(input: {
  hasHumanResolutionQuestion: boolean;
  messages: AgentTeamDialogueMessageDraft[];
  queueTargets: string[];
  teamRoles: AgentTeamRole[];
}): string[] {
  if (!input.hasHumanResolutionQuestion) {
    return input.queueTargets;
  }

  const roleKeys = new Set(input.teamRoles.map((role) => role.roleKey));
  const directlyAddressedWakeTargets = new Set(
    input.messages
      .filter((message) => roleKeys.has(message.toRoleKey) && shouldWakeTarget(message.kind))
      .map((message) => message.toRoleKey)
  );

  return input.queueTargets.filter((roleKey) => directlyAddressedWakeTargets.has(roleKey));
}

export function applyMessageBudget(input: {
  currentMessageCount: number;
  maxMessages: number;
  messages: AgentTeamDialogueMessageDraft[];
}): MessageBudgetResult {
  const remainingCapacity = Math.max(input.maxMessages - input.currentMessageCount, 0);
  if (input.messages.length <= remainingCapacity) {
    return {
      messages: input.messages,
      droppedCount: 0,
      remainingCapacity,
    };
  }

  const prioritizedMessages = [...input.messages].sort(compareMessagesForBudget);
  const messages = prioritizedMessages.slice(0, remainingCapacity);
  return {
    messages,
    droppedCount: input.messages.length - messages.length,
    remainingCapacity,
  };
}

export function shouldWaitAtTurnBudget(progress: RunBudgetProgress): boolean {
  return (
    progress.queuedInboxCount > 0 ||
    progress.blockedInboxCount > 0 ||
    progress.openQuestionCount > 0
  );
}

function compareMessagesForBudget(
  left: AgentTeamDialogueMessageDraft,
  right: AgentTeamDialogueMessageDraft
): number {
  return getMessageBudgetPriority(left.kind) - getMessageBudgetPriority(right.kind);
}

function getMessageBudgetPriority(kind: AgentTeamMessageKind): number {
  switch (kind) {
    case AGENT_TEAM_MESSAGE_KIND.toolCall:
    case AGENT_TEAM_MESSAGE_KIND.toolResult:
    case AGENT_TEAM_MESSAGE_KIND.status:
      return 1;
    default:
      return 0;
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

function shouldWakeRoleForMessage(
  targetRole: AgentTeamRole,
  message: AgentTeamDialogueMessageDraft
): boolean {
  if (targetRole.slug !== AGENT_TEAM_ROLE_SLUG.prCreator) {
    return true;
  }

  return isActionablePrCreatorMessage(message);
}

function hasActionablePrCreatorHandoff(
  messages: AgentTeamDialogueMessageDraft[],
  prCreatorRoleKey: string
): boolean {
  return messages.some(
    (message) => message.toRoleKey === prCreatorRoleKey && isActionablePrCreatorMessage(message)
  );
}

function isActionablePrCreatorMessage(message: AgentTeamDialogueMessageDraft): boolean {
  if (message.kind === AGENT_TEAM_MESSAGE_KIND.approval) {
    return true;
  }

  const text = `${message.subject}\n${message.content}`.toLowerCase();
  const hasPositiveSignal =
    text.includes("create pr") ||
    text.includes("draft pr") ||
    text.includes("open pr") ||
    text.includes("pull request") ||
    text.includes("bounded fix") ||
    text.includes("target file") ||
    text.includes("implement") ||
    text.includes("fix") ||
    text.includes("change") ||
    text.includes("update") ||
    text.includes("edit") ||
    text.includes("ship");

  if (!hasPositiveSignal) {
    return false;
  }

  return !(
    text.includes("no specific file") ||
    text.includes("no file") ||
    text.includes("cannot locate") ||
    text.includes("not found") ||
    text.includes("unsuccessful") ||
    text.includes("confirm if") ||
    text.includes("recommend confirming") ||
    text.includes("no further action") ||
    text.includes("no action needed")
  );
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

function resolveMissingCanonicalRoleTarget(input: {
  senderRole: AgentTeamRole;
  teamRoles: AgentTeamRole[];
  missingTarget: string;
}): AgentTeamRole | null {
  if (input.missingTarget !== AGENT_TEAM_ROLE_SLUG.reviewer) {
    return null;
  }

  if (input.teamRoles.some((role) => role.slug === AGENT_TEAM_ROLE_SLUG.reviewer)) {
    return null;
  }

  const prCreator = input.teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.prCreator);
  if (!prCreator || !canRouteTo(input.senderRole.slug, prCreator.slug)) {
    return null;
  }

  return prCreator;
}

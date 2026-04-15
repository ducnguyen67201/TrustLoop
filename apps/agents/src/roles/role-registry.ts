import {
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TOOL_ID,
  type AgentTeamRole,
  type AgentTeamRoleSlug,
  type AgentTeamToolId,
} from "@shared/types";
import { ARCHITECT_ROLE_SYSTEM_PROMPT } from "./architect.prompt";
import { CODE_READER_ROLE_SYSTEM_PROMPT } from "./code-reader.prompt";
import { PR_CREATOR_ROLE_SYSTEM_PROMPT } from "./pr-creator.prompt";
import { RCA_ANALYST_ROLE_SYSTEM_PROMPT } from "./rca-analyst.prompt";
import { REVIEWER_ROLE_SYSTEM_PROMPT } from "./reviewer.prompt";

interface RoleDefinition {
  readonly label: string;
  readonly defaultToolIds: readonly AgentTeamToolId[];
  readonly defaultMaxSteps: number;
  readonly systemPrompt: string;
}

export const AGENT_ROLE_REGISTRY: Record<AgentTeamRoleSlug, RoleDefinition> = {
  [AGENT_TEAM_ROLE_SLUG.architect]: {
    label: "Architect",
    defaultToolIds: [AGENT_TEAM_TOOL_ID.searchCode, AGENT_TEAM_TOOL_ID.searchSentry],
    defaultMaxSteps: 8,
    systemPrompt: ARCHITECT_ROLE_SYSTEM_PROMPT,
  },
  [AGENT_TEAM_ROLE_SLUG.reviewer]: {
    label: "Reviewer",
    defaultToolIds: [AGENT_TEAM_TOOL_ID.searchCode, AGENT_TEAM_TOOL_ID.searchSentry],
    defaultMaxSteps: 6,
    systemPrompt: REVIEWER_ROLE_SYSTEM_PROMPT,
  },
  [AGENT_TEAM_ROLE_SLUG.codeReader]: {
    label: "Code Reader",
    defaultToolIds: [AGENT_TEAM_TOOL_ID.searchCode],
    defaultMaxSteps: 6,
    systemPrompt: CODE_READER_ROLE_SYSTEM_PROMPT,
  },
  [AGENT_TEAM_ROLE_SLUG.prCreator]: {
    label: "PR Creator",
    defaultToolIds: [AGENT_TEAM_TOOL_ID.searchCode, AGENT_TEAM_TOOL_ID.createPullRequest],
    defaultMaxSteps: 8,
    systemPrompt: PR_CREATOR_ROLE_SYSTEM_PROMPT,
  },
  [AGENT_TEAM_ROLE_SLUG.rcaAnalyst]: {
    label: "RCA Analyst",
    defaultToolIds: [AGENT_TEAM_TOOL_ID.searchSentry, AGENT_TEAM_TOOL_ID.searchCode],
    defaultMaxSteps: 6,
    systemPrompt: RCA_ANALYST_ROLE_SYSTEM_PROMPT,
  },
};

export function getRoleDefinition(slug: AgentTeamRoleSlug): RoleDefinition {
  return AGENT_ROLE_REGISTRY[slug];
}

export function getRoleToolIds(role: AgentTeamRole): readonly AgentTeamToolId[] {
  if (role.toolIds.length > 0) {
    return role.toolIds;
  }

  return getRoleDefinition(role.slug).defaultToolIds;
}

export function getRoleMaxSteps(role: AgentTeamRole): number {
  return role.maxSteps ?? getRoleDefinition(role.slug).defaultMaxSteps;
}

export function getRoleSystemPrompt(role: AgentTeamRole): string {
  return role.systemPromptOverride ?? getRoleDefinition(role.slug).systemPrompt;
}

import type { RemixiconComponentType } from "@remixicon/react";
import {
  RiBrainLine,
  RiCodeSSlashLine,
  RiGitPullRequestLine,
  RiMicroscopeLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import {
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TOOL_ID,
  type AgentTeamRoleSlug,
  type AgentTeamToolId,
} from "@shared/types";

interface RoleVisual {
  icon: RemixiconComponentType;
  color: string;
  archetype: string;
  flavorText: string;
}

export const ROLE_VISUALS: Record<AgentTeamRoleSlug, RoleVisual> = {
  [AGENT_TEAM_ROLE_SLUG.architect]: {
    icon: RiBrainLine,
    color: "#f5a623",
    archetype: "The Coordinator",
    flavorText: "Orchestrates the team, forms hypotheses, and produces final decisions.",
  },
  [AGENT_TEAM_ROLE_SLUG.codeReader]: {
    icon: RiCodeSSlashLine,
    color: "#3b82f6",
    archetype: "The Scout",
    flavorText: "Searches source code, traces errors, and surfaces evidence.",
  },
  [AGENT_TEAM_ROLE_SLUG.reviewer]: {
    icon: RiShieldCheckLine,
    color: "#ef4444",
    archetype: "The Guardian",
    flavorText: "Challenges hypotheses, verifies evidence, and approves actions.",
  },
  [AGENT_TEAM_ROLE_SLUG.rcaAnalyst]: {
    icon: RiMicroscopeLine,
    color: "#a855f7",
    archetype: "The Detective",
    flavorText: "Deep analysis, pattern matching, and root cause identification.",
  },
  [AGENT_TEAM_ROLE_SLUG.prCreator]: {
    icon: RiGitPullRequestLine,
    color: "#22c55e",
    archetype: "The Executor",
    flavorText: "Ships fixes and creates pull requests. Requires Guardian approval.",
  },
};

export function getRoleVisual(slug: AgentTeamRoleSlug): RoleVisual {
  return ROLE_VISUALS[slug];
}

/**
 * Default label for each role slug (used when auto-assembling).
 */
export const ROLE_LABELS: Record<AgentTeamRoleSlug, string> = {
  [AGENT_TEAM_ROLE_SLUG.architect]: "Architect",
  [AGENT_TEAM_ROLE_SLUG.codeReader]: "Code Reader",
  [AGENT_TEAM_ROLE_SLUG.reviewer]: "Reviewer",
  [AGENT_TEAM_ROLE_SLUG.rcaAnalyst]: "RCA Analyst",
  [AGENT_TEAM_ROLE_SLUG.prCreator]: "PR Creator",
};

/**
 * Default tool assignments per role (used when auto-assembling).
 */
export const ROLE_DEFAULT_TOOLS: Partial<Record<AgentTeamRoleSlug, AgentTeamToolId[]>> = {
  [AGENT_TEAM_ROLE_SLUG.codeReader]: [AGENT_TEAM_TOOL_ID.searchCode],
  [AGENT_TEAM_ROLE_SLUG.prCreator]: [AGENT_TEAM_TOOL_ID.createPullRequest],
};

/**
 * Standard connection blueprint: [sourceSlug, targetSlug] pairs.
 * Defines the default communication topology for a full team.
 */
export const STANDARD_CONNECTIONS: [AgentTeamRoleSlug, AgentTeamRoleSlug][] = [
  [AGENT_TEAM_ROLE_SLUG.architect, AGENT_TEAM_ROLE_SLUG.codeReader],
  [AGENT_TEAM_ROLE_SLUG.architect, AGENT_TEAM_ROLE_SLUG.reviewer],
  [AGENT_TEAM_ROLE_SLUG.architect, AGENT_TEAM_ROLE_SLUG.rcaAnalyst],
  [AGENT_TEAM_ROLE_SLUG.architect, AGENT_TEAM_ROLE_SLUG.prCreator],
  [AGENT_TEAM_ROLE_SLUG.codeReader, AGENT_TEAM_ROLE_SLUG.reviewer],
  [AGENT_TEAM_ROLE_SLUG.rcaAnalyst, AGENT_TEAM_ROLE_SLUG.reviewer],
  [AGENT_TEAM_ROLE_SLUG.reviewer, AGENT_TEAM_ROLE_SLUG.prCreator],
];

/**
 * Ordered list of all role slugs for consistent iteration.
 */
export const ALL_ROLE_SLUGS: AgentTeamRoleSlug[] = [
  AGENT_TEAM_ROLE_SLUG.architect,
  AGENT_TEAM_ROLE_SLUG.codeReader,
  AGENT_TEAM_ROLE_SLUG.reviewer,
  AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
  AGENT_TEAM_ROLE_SLUG.prCreator,
];

import {
  AGENT_TEAM_ROLE_SLUG,
  type AgentTeamRoleSlug,
  agentTeamRoleSlugSchema,
} from "./agent-team-core.schema";

export const AGENT_TEAM_ROUTING_POLICY: Record<AgentTeamRoleSlug, readonly AgentTeamRoleSlug[]> = {
  // Drafter is the FAST-path role. It runs in isolation (single-role team
  // snapshot) so addressed dialogue is not exercised — empty allow-list is
  // intentional. If a drafter ever appears in a multi-role config, escalation
  // to the architect is the natural target.
  [AGENT_TEAM_ROLE_SLUG.drafter]: [],
  [AGENT_TEAM_ROLE_SLUG.architect]: [
    AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
    AGENT_TEAM_ROLE_SLUG.codeReader,
    AGENT_TEAM_ROLE_SLUG.reviewer,
    AGENT_TEAM_ROLE_SLUG.prCreator,
  ],
  [AGENT_TEAM_ROLE_SLUG.rcaAnalyst]: [
    AGENT_TEAM_ROLE_SLUG.architect,
    AGENT_TEAM_ROLE_SLUG.reviewer,
  ],
  [AGENT_TEAM_ROLE_SLUG.codeReader]: [
    AGENT_TEAM_ROLE_SLUG.architect,
    AGENT_TEAM_ROLE_SLUG.reviewer,
  ],
  [AGENT_TEAM_ROLE_SLUG.reviewer]: [AGENT_TEAM_ROLE_SLUG.architect, AGENT_TEAM_ROLE_SLUG.prCreator],
  [AGENT_TEAM_ROLE_SLUG.prCreator]: [AGENT_TEAM_ROLE_SLUG.architect, AGENT_TEAM_ROLE_SLUG.reviewer],
};

export function listAllowedTargets(roleSlug: AgentTeamRoleSlug): readonly AgentTeamRoleSlug[] {
  return AGENT_TEAM_ROUTING_POLICY[roleSlug];
}

export function canRouteTo(
  fromRoleSlug: AgentTeamRoleSlug,
  toRoleSlug: AgentTeamRoleSlug
): boolean {
  return AGENT_TEAM_ROUTING_POLICY[fromRoleSlug].includes(
    agentTeamRoleSlugSchema.parse(toRoleSlug)
  );
}

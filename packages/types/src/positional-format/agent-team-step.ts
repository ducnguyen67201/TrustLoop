import { z } from "zod";

export const compressedAgentTeamStepOutputSchema = z.object({
  m: z.string(),
  h: z.string().nullable(),
});

export type CompressedAgentTeamStepOutput = z.infer<typeof compressedAgentTeamStepOutputSchema>;

export type ReconstructedAgentTeamStepOutput = {
  message: string;
  handoff: {
    targetRoleSlug: string;
    reason: string;
  } | null;
};

export function reconstructAgentTeamStepOutput(
  compressed: CompressedAgentTeamStepOutput
): ReconstructedAgentTeamStepOutput {
  if (!compressed.h) {
    return {
      message: compressed.m,
      handoff: null,
    };
  }

  const [targetRoleSlug, ...reasonParts] = compressed.h.split("|");
  return {
    message: compressed.m,
    handoff: targetRoleSlug
      ? {
          targetRoleSlug,
          reason: reasonParts.join("|") || "Continue with the next role",
        }
      : null,
  };
}

export const POSITIONAL_AGENT_TEAM_STEP_FORMAT_INSTRUCTIONS = `
Field reference:
  m = primary message for the collaboration thread
  h = handoff encoded as "target_role_slug|reason", or null when no explicit handoff is needed

Allowed role slugs:
  architect, reviewer, code_reader, pr_creator, rca_analyst

Example with handoff:
{"m":"I found the likely fault line in the Slack reply resolver. The next role should verify the exact file and call path before we open a PR.","h":"code_reader|Verify the concrete implementation path and cite the file that owns reply threading."}

Example without handoff:
{"m":"The prior investigation is sound. I agree with the fix shape and do not see a blocking risk. Ready for PR creation.","h":null}`;

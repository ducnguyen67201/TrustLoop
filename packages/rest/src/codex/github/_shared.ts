import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "@shared/env";
import { ValidationError } from "@shared/types";

// ---------------------------------------------------------------------------
// codex/github/_shared — authenticated Octokit factory
//
// Only the factory lives here — it's shared by `installation.ts` (install
// repo listing, installation owner lookup) and `content.ts` (tree, file
// contents, commit SHA). Everything else is concern-specific.
// ---------------------------------------------------------------------------

/**
 * Create an authenticated Octokit instance for a GitHub App installation.
 */
export function createInstallationOctokit(installationId: number): Octokit {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new ValidationError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured");
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });
}

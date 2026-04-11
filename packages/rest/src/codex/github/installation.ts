import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { ensureWorkspace, getSettings } from "@shared/rest/codex/shared";
import {
  type ConnectGithubInstallationRequest,
  type ConnectGithubInstallationResponse,
  REPOSITORY_BRANCH_POLICY,
  ValidationError,
  connectGithubInstallationRequestSchema,
  connectGithubInstallationResponseSchema,
} from "@shared/types";
import { createInstallationOctokit } from "./_shared";
import { verifyAndDecodeGithubState } from "./install-url";

// ---------------------------------------------------------------------------
// codex/github/installation — GitHub App installation lifecycle
//
// Connect, disconnect, refresh repo listings, and handle the post-install
// callback. All operations funnel through the GitHub App credentials
// (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY); per-installation operations
// use the Octokit factory from _shared.ts.
// ---------------------------------------------------------------------------

/**
 * Fetch the installation owner (org or user) from GitHub API.
 * Uses app-level (not installation-level) auth because we only need the
 * metadata, not repo access.
 */
async function fetchInstallationOwner(installationId: number): Promise<string> {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new ValidationError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured");
  }

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });

  const { data } = await appOctokit.apps.getInstallation({ installation_id: installationId });
  const account = data.account as { login?: string } | null;
  return account?.login ?? "unknown";
}

/**
 * Fetch all repositories accessible to a GitHub App installation.
 */
async function fetchInstallationRepositories(installationId: number): Promise<
  Array<{
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }>
> {
  const octokit = createInstallationOctokit(installationId);
  const repos: Array<{
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }> = [];

  for await (const response of octokit.paginate.iterator(
    octokit.apps.listReposAccessibleToInstallation,
    { per_page: 100 }
  )) {
    for (const repo of response.data) {
      repos.push({
        owner: repo.owner?.login ?? "unknown",
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? "main",
      });
    }
  }

  return repos;
}

/**
 * Connect a GitHub App installation to a workspace: save installation record,
 * fetch repos from GitHub API, and populate the Repository table.
 */
export async function connectGithubInstallation(
  input: ConnectGithubInstallationRequest
): Promise<ConnectGithubInstallationResponse> {
  const parsed = connectGithubInstallationRequestSchema.parse(input);
  await ensureWorkspace(parsed.workspaceId);

  await prisma.gitHubInstallation.upsert({
    where: { workspaceId: parsed.workspaceId },
    create: {
      workspaceId: parsed.workspaceId,
      githubInstallationId: parsed.githubInstallationId,
      installationOwner: parsed.installationOwner,
      missingPermissions: [],
    },
    update: {
      githubInstallationId: parsed.githubInstallationId,
      installationOwner: parsed.installationOwner,
      missingPermissions: [],
      connectedAt: new Date(),
    },
  });

  // Fetch repos from GitHub and sync to the Repository table
  const githubRepos = await fetchInstallationRepositories(parsed.githubInstallationId);

  for (const repo of githubRepos) {
    await prisma.repository.upsert({
      where: {
        workspaceId_fullName: {
          workspaceId: parsed.workspaceId,
          fullName: repo.fullName,
        },
      },
      create: {
        workspaceId: parsed.workspaceId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        branchPolicy: REPOSITORY_BRANCH_POLICY.defaultBranchOnly,
        selected: false,
      },
      update: {
        owner: repo.owner,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
      },
    });
  }

  const settings = await getSettings(parsed.workspaceId);

  return connectGithubInstallationResponseSchema.parse({
    connection: settings.githubConnection,
    repositories: settings.repositories,
  });
}

/**
 * Remove the GitHub installation and all associated repositories from a workspace.
 * Called when the user disconnects GitHub or when the installation is deleted on GitHub's side.
 */
export async function disconnectGithubInstallation(workspaceId: string): Promise<void> {
  await prisma.gitHubInstallation.deleteMany({ where: { workspaceId } });
  await prisma.repository.deleteMany({ where: { workspaceId } });
}

/**
 * Re-fetch accessible repos from GitHub API and sync the Repository table.
 * Use after the user modifies repo access on GitHub (no callback fired).
 */
export async function refreshInstallationRepos(workspaceId: string): Promise<void> {
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { workspaceId },
  });
  if (!installation || !installation.githubInstallationId) {
    throw new ValidationError("No GitHub installation found for this workspace.");
  }

  const githubRepos = await fetchInstallationRepositories(installation.githubInstallationId);

  for (const repo of githubRepos) {
    await prisma.repository.upsert({
      where: {
        workspaceId_fullName: {
          workspaceId,
          fullName: repo.fullName,
        },
      },
      create: {
        workspaceId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        branchPolicy: REPOSITORY_BRANCH_POLICY.defaultBranchOnly,
        selected: false,
      },
      update: {
        owner: repo.owner,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
      },
    });
  }
}

/**
 * Handle the GitHub App callback: verify state, fetch installation metadata,
 * connect the installation, and return the workspaceId for redirect.
 */
export async function handleGithubInstallationCallback(
  installationId: number,
  state: string
): Promise<{ workspaceId: string }> {
  const { workspaceId } = verifyAndDecodeGithubState(state);
  const owner = await fetchInstallationOwner(installationId);

  await connectGithubInstallation({
    workspaceId,
    githubInstallationId: installationId,
    installationOwner: owner,
  });

  return { workspaceId };
}

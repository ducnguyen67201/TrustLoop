import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { ensureWorkspace, getSettings } from "@shared/rest/codex/shared";
import {
  type ConnectGithubInstallationRequest,
  type ConnectGithubInstallationResponse,
  type GithubOAuthStatePayload,
  REPOSITORY_BRANCH_POLICY,
  ValidationError,
  connectGithubInstallationRequestSchema,
  connectGithubInstallationResponseSchema,
  githubOAuthStatePayloadSchema,
} from "@shared/types";

/** State token expiry: 10 minutes. */
const STATE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// State HMAC helpers (same pattern as Slack OAuth)
// ---------------------------------------------------------------------------

function getSigningKey(): string {
  return env.SESSION_SECRET;
}

function hmacSign(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function base64UrlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the GitHub App installation URL with HMAC-signed state.
 * State encodes the workspaceId so the callback knows which workspace to bind.
 */
export function generateGithubInstallUrl(workspaceId: string): string {
  const appSlug = env.GITHUB_APP_SLUG;
  if (!appSlug) {
    throw new ValidationError("GITHUB_APP_SLUG is not configured");
  }

  const statePayload: GithubOAuthStatePayload = {
    workspaceId,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: Date.now() + STATE_TTL_MS,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(statePayload));
  const signature = hmacSign(payloadB64);
  const state = `${payloadB64}.${signature}`;

  return `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * Verify HMAC and decode the GitHub OAuth state parameter.
 * Throws ValidationError on tamper, expiry, or malformed input.
 */
export function verifyAndDecodeGithubState(state: string): { workspaceId: string } {
  const dotIndex = state.indexOf(".");
  if (dotIndex === -1) {
    throw new ValidationError("Malformed OAuth state");
  }

  const payloadB64 = state.slice(0, dotIndex);
  const providedSig = state.slice(dotIndex + 1);
  const expectedSig = hmacSign(payloadB64);

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new ValidationError("OAuth state signature verification failed");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    throw new ValidationError("OAuth state payload is not valid JSON");
  }

  const parsed = githubOAuthStatePayloadSchema.parse(raw);

  if (Date.now() > parsed.expiresAt) {
    throw new ValidationError("OAuth state has expired — please try again");
  }

  return { workspaceId: parsed.workspaceId };
}

/**
 * Create an authenticated Octokit instance for a GitHub App installation.
 */
function createInstallationOctokit(installationId: number): Octokit {
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

/**
 * Fetch the installation owner (org or user) from GitHub API.
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

// ---------------------------------------------------------------------------
// Repository file reading (GitHub API, no local clone)
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 100_000;
const CONTENT_FETCH_CONCURRENCY = 20;

export type RepoTreeEntry = {
  path: string;
  sha: string;
  size: number;
};

export async function fetchRepoTree(
  installationId: number,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoTreeEntry[]> {
  const octokit = createInstallationOctokit(installationId);
  const { data } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "1",
  });

  return (data.tree ?? [])
    .filter(
      (entry): entry is typeof entry & { path: string; sha: string; size: number } =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string" &&
        typeof entry.size === "number" &&
        entry.size <= MAX_FILE_SIZE
    )
    .map((entry) => ({
      path: entry.path,
      sha: entry.sha,
      size: entry.size,
    }));
}

export async function fetchFileContents(
  installationId: number,
  owner: string,
  repo: string,
  ref: string,
  paths: string[]
): Promise<Array<{ path: string; content: string }>> {
  const octokit = createInstallationOctokit(installationId);
  const results: Array<{ path: string; content: string }> = [];

  for (let i = 0; i < paths.length; i += CONTENT_FETCH_CONCURRENCY) {
    const batch = paths.slice(i, i + CONTENT_FETCH_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (path) => {
        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref,
          });

          if ("content" in data && typeof data.content === "string") {
            return {
              path,
              content: Buffer.from(data.content, "base64").toString("utf8"),
            };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    for (const file of fetched) {
      if (file) results.push(file);
    }
  }

  return results;
}

export async function fetchLatestCommitSha(
  installationId: number,
  owner: string,
  repo: string,
  branch: string
): Promise<string | null> {
  try {
    const octokit = createInstallationOctokit(installationId);
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      sha: branch,
      per_page: 1,
    });
    return data[0]?.sha?.substring(0, 7) ?? null;
  } catch {
    return null;
  }
}

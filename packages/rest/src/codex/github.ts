import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  type ConnectGithubInstallationRequest,
  type ConnectGithubInstallationResponse,
  REPOSITORY_BRANCH_POLICY,
  ValidationError,
  connectGithubInstallationRequestSchema,
  connectGithubInstallationResponseSchema,
  type GithubOAuthStatePayload,
  githubOAuthStatePayloadSchema,
} from "@shared/types";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { ensureWorkspace, getCodexSettings } from "@shared/rest/codex/shared";

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
async function fetchInstallationRepositories(
  installationId: number
): Promise<
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

  const settings = await getCodexSettings(parsed.workspaceId);

  return connectGithubInstallationResponseSchema.parse({
    connection: settings.githubConnection,
    repositories: settings.repositories,
  });
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

import { execFile } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { prisma } from "@shared/database";
import {
  type CodexSettingsResponse,
  ConflictError,
  GITHUB_CONNECTION_STATUS,
  type GithubConnectionSummary,
  REPOSITORY_BRANCH_POLICY,
  REPOSITORY_HEALTH_STATUS,
  REPOSITORY_SYNC_REQUEST_STATUS,
  type RepositoryHealthStatus,
  type RepositoryIndexHealth,
  type RepositorySummary,
  codexSettingsResponseSchema,
  githubConnectionSummarySchema,
  repositoryIndexHealthSchema,
  repositorySummarySchema,
} from "@shared/types";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKSPACE_ID = "workspace_default";
export const DEFAULT_WORKSPACE_NAME = "Default Workspace";
export const DEFAULT_REPOSITORY_FRESHNESS_SLA_MINUTES = 24 * 60;
export const DEFAULT_GITHUB_PERMISSIONS = [
  "contents:write",
  "metadata:read",
  "pull_requests:write",
];

function resolveMonorepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
}

async function runGit(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", resolveMonorepoRoot(), ...args]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function detectSeedRepositoryMetadata(): Promise<{
  owner: string;
  name: string;
  defaultBranch: string;
  sourceRoot: string;
}> {
  const sourceRoot = resolveMonorepoRoot();
  const remoteUrl = await runGit(["config", "--get", "remote.origin.url"]);
  const defaultBranch =
    (await runGit(["symbolic-ref", "refs/remotes/origin/HEAD"]))?.split("/").pop() ?? "main";

  if (remoteUrl) {
    const match = remoteUrl.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match?.[1] && match[2]) {
      return {
        owner: match[1],
        name: match[2],
        defaultBranch,
        sourceRoot,
      };
    }
  }

  return {
    owner: "local",
    name: basename(sourceRoot),
    defaultBranch,
    sourceRoot,
  };
}

/**
 * Ensure there is always a workspace target while the product is still single-tenant.
 */
export async function ensureWorkspace(workspaceId = DEFAULT_WORKSPACE_ID) {
  return prisma.workspace.upsert({
    where: { id: workspaceId },
    create: {
      id: workspaceId,
      name: DEFAULT_WORKSPACE_NAME,
    },
    update: {},
  });
}

/**
 * Seed the repository catalog with the current monorepo so local indexing can work end-to-end.
 */
export async function ensureRepositoryCatalog(workspaceId: string) {
  const existing = await prisma.repository.count({ where: { workspaceId } });
  if (existing > 0) {
    return;
  }

  const seed = await detectSeedRepositoryMetadata();

  await prisma.repository.create({
    data: {
      workspaceId,
      owner: seed.owner,
      name: seed.name,
      fullName: `${seed.owner}/${seed.name}`,
      sourceRoot: seed.sourceRoot,
      defaultBranch: seed.defaultBranch,
      branchPolicy: REPOSITORY_BRANCH_POLICY.defaultBranchOnly,
      selected: false,
    },
  });
}

function buildGithubConnectionSummary(
  installation: {
    githubInstallationId: number | null;
    installationOwner: string;
    connectedAt: Date;
    missingPermissions: string[];
  } | null
): GithubConnectionSummary {
  const summary = installation?.githubInstallationId
    ? {
        status:
          installation.missingPermissions.length > 0
            ? GITHUB_CONNECTION_STATUS.permissionGap
            : GITHUB_CONNECTION_STATUS.connected,
        installationOwner: installation.installationOwner,
        connectedAt: installation.connectedAt.toISOString(),
        missingPermissions: installation.missingPermissions,
      }
    : {
        status: GITHUB_CONNECTION_STATUS.disconnected,
        installationOwner: null,
        connectedAt: null,
        missingPermissions: [],
      };

  return githubConnectionSummarySchema.parse(summary);
}

/**
 * Convert repository sync/version state into the user-facing trust signal used by the UI and PR gate.
 */
export function buildRepositoryHealth(args: {
  latestSyncRequest: {
    requestedAt: Date;
    completedAt: Date | null;
    errorMessage: string | null;
    status: string;
  } | null;
  activeVersion: {
    id: string;
    commitSha: string | null;
    completedAt: Date | null;
  } | null;
}): RepositoryIndexHealth {
  const { latestSyncRequest, activeVersion } = args;
  const activeCompletedAt = activeVersion?.completedAt ?? null;
  const ageMinutes = activeCompletedAt
    ? (Date.now() - activeCompletedAt.getTime()) / (1000 * 60)
    : Number.POSITIVE_INFINITY;

  let status: RepositoryHealthStatus = REPOSITORY_HEALTH_STATUS.needsSetup;
  let syncStageLabel: string | null = null;

  if (latestSyncRequest?.status === REPOSITORY_SYNC_REQUEST_STATUS.pending) {
    status = REPOSITORY_HEALTH_STATUS.syncing;
    syncStageLabel = "Queued";
  } else if (latestSyncRequest?.status === REPOSITORY_SYNC_REQUEST_STATUS.running) {
    status = REPOSITORY_HEALTH_STATUS.syncing;
    syncStageLabel = "Indexing";
  } else if (latestSyncRequest?.status === REPOSITORY_SYNC_REQUEST_STATUS.failed) {
    status = REPOSITORY_HEALTH_STATUS.error;
  } else if (activeVersion) {
    status =
      ageMinutes <= DEFAULT_REPOSITORY_FRESHNESS_SLA_MINUTES
        ? REPOSITORY_HEALTH_STATUS.ready
        : REPOSITORY_HEALTH_STATUS.stale;
  }

  return repositoryIndexHealthSchema.parse({
    status,
    staleAfterMinutes: DEFAULT_REPOSITORY_FRESHNESS_SLA_MINUTES,
    lastSyncRequestedAt: latestSyncRequest?.requestedAt.toISOString() ?? null,
    lastCompletedAt:
      latestSyncRequest?.completedAt?.toISOString() ?? activeCompletedAt?.toISOString() ?? null,
    activeCommitSha: activeVersion?.commitSha ?? null,
    activeVersionId: activeVersion?.id ?? null,
    lastErrorMessage: latestSyncRequest?.errorMessage ?? null,
    syncStageLabel,
  });
}

export function toRepositorySummary(repository: {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  selected: boolean;
  defaultBranch: string;
  branchPolicy: string;
  syncRequests: Array<{
    requestedAt: Date;
    completedAt: Date | null;
    errorMessage: string | null;
    status: string;
  }>;
  indexVersions: Array<{
    id: string;
    commitSha: string | null;
    completedAt: Date | null;
  }>;
}): RepositorySummary {
  return repositorySummarySchema.parse({
    id: repository.id,
    owner: repository.owner,
    name: repository.name,
    fullName: repository.fullName,
    selected: repository.selected,
    defaultBranch: repository.defaultBranch,
    branchPolicy: repository.branchPolicy,
    indexHealth: buildRepositoryHealth({
      latestSyncRequest: repository.syncRequests[0] ?? null,
      activeVersion: repository.indexVersions[0] ?? null,
    }),
  });
}

/**
 * Load the current repository settings view, including connection status and trust signals.
 */
export async function getSettings(
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<CodexSettingsResponse> {
  const workspace = await ensureWorkspace(workspaceId);
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { workspaceId },
  });

  if (installation) {
    await ensureRepositoryCatalog(workspaceId);
  }

  const repositories = await prisma.repository.findMany({
    where: { workspaceId },
    orderBy: { fullName: "asc" },
    include: {
      syncRequests: {
        orderBy: { requestedAt: "desc" },
        take: 1,
      },
      indexVersions: {
        where: { active: true },
        orderBy: { activatedAt: "desc" },
        take: 1,
      },
    },
  });

  return codexSettingsResponseSchema.parse({
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    githubConnection: buildGithubConnectionSummary(installation),
    repositories: repositories.map(toRepositorySummary),
  });
}

/**
 * Require a repository under the given workspace and return its latest sync/version state.
 */
export async function requireRepositorySnapshot(workspaceId: string, repositoryId: string) {
  const repository = await prisma.repository.findFirst({
    where: {
      id: repositoryId,
      workspaceId,
    },
    include: {
      syncRequests: {
        orderBy: { requestedAt: "desc" },
        take: 1,
      },
      indexVersions: {
        where: { active: true },
        orderBy: { activatedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!repository) {
    throw new ConflictError("Repository not found for this workspace.");
  }

  return {
    repository,
    summary: toRepositorySummary(repository),
  };
}

"use server";

import {
  disconnectGithubInstallation,
  preparePullRequestIntent,
  recordSearchFeedback,
  refreshInstallationRepos,
  requestRepositorySync,
  searchRepositoryCode,
  updateRepositorySelection,
} from "@shared/rest";
import { ConflictError } from "@shared/types";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

function githubSettingsPath(workspaceId: string): string {
  return `/${workspaceId}/settings/github`;
}

function buildReturnPath(
  workspaceId: string,
  params: Record<string, string | undefined>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const base = githubSettingsPath(workspaceId);
  const query = searchParams.toString();
  return query ? `${base}?${query}` : base;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getActionErrorMessage(error: unknown): string {
  if (error instanceof ConflictError || error instanceof ZodError) {
    return error.message;
  }

  return "Something went wrong while updating codex settings.";
}

/**
 * Re-fetch repos from GitHub after the user modifies installation access.
 */
export async function refreshGitHubReposAction(workspaceId: string): Promise<{ error?: string }> {
  try {
    await refreshInstallationRepos(workspaceId);
    revalidatePath(githubSettingsPath(workspaceId));
    return {};
  } catch (error) {
    return { error: getActionErrorMessage(error) };
  }
}

/**
 * Remove GitHub installation and all repository records from the workspace.
 */
export async function disconnectGitHubAction(formData: FormData): Promise<never> {
  const workspaceId = getString(formData, "workspaceId");

  try {
    await disconnectGithubInstallation(workspaceId);
    revalidatePath(githubSettingsPath(workspaceId));
    redirect(
      buildReturnPath(workspaceId, {
        flash: "GitHub disconnected. All repositories removed.",
        tone: "success",
      })
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(
      buildReturnPath(workspaceId, {
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

/**
 * Toggle whether a repository is part of the indexed scope.
 */
export async function toggleRepositorySelectionAction(formData: FormData): Promise<never> {
  const workspaceId = getString(formData, "workspaceId");
  const repositoryId = getString(formData, "repositoryId");
  const selected = getString(formData, "selected") === "true";

  try {
    await updateRepositorySelection({
      workspaceId,
      repositoryId,
      selected,
    });

    revalidatePath(githubSettingsPath(workspaceId));
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        flash: selected ? "Repository added to scope." : "Repository removed from scope.",
        tone: "success",
      })
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

/**
 * Enqueue a manual repository sync through the unified sync ingress path.
 */
export async function syncRepositoryAction(formData: FormData): Promise<never> {
  const workspaceId = getString(formData, "workspaceId");
  const repositoryId = getString(formData, "repositoryId");

  try {
    await requestRepositorySync({
      workspaceId,
      repositoryId,
      triggerSource: "manual",
    });

    revalidatePath(githubSettingsPath(workspaceId));
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        flash: "Sync queued on the codex worker.",
        tone: "success",
      })
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

/**
 * Run evidence retrieval once and redirect to the persisted query receipt.
 */
export async function searchEvidenceAction(formData: FormData): Promise<never> {
  const workspaceId = getString(formData, "workspaceId");
  const repositoryId = getString(formData, "repositoryId");
  const query = getString(formData, "query");

  try {
    const result = await searchRepositoryCode({
      workspaceId,
      repositoryId,
      query,
      limit: 5,
    });

    revalidatePath(githubSettingsPath(workspaceId));
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        query,
        queryAuditId: result.queryAuditId,
        flash: "Evidence refreshed.",
        tone: "success",
      })
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        query,
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

/**
 * Save operator feedback against a persisted search result.
 */
export async function submitFeedbackAction(formData: FormData): Promise<never> {
  const workspaceId = getString(formData, "workspaceId");
  const repositoryId = getString(formData, "repositoryId");
  const query = getString(formData, "query");
  const queryAuditId = getString(formData, "queryAuditId");

  try {
    await recordSearchFeedback({
      workspaceId,
      queryAuditId,
      searchResultId: getString(formData, "searchResultId"),
      label: getString(formData, "label") === "useful" ? "useful" : "off_target",
      note: undefined,
    });

    revalidatePath(githubSettingsPath(workspaceId));
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        query,
        queryAuditId,
        flash: "Feedback stored.",
        tone: "success",
      })
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        query,
        queryAuditId,
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

/**
 * Validate and persist a PR intent only when the active repository snapshot is fresh.
 */
export async function preparePrIntentAction(formData: FormData): Promise<never> {
  const workspaceId = getString(formData, "workspaceId");
  const repositoryId = getString(formData, "repositoryId");
  const query = getString(formData, "query");
  const queryAuditId = getString(formData, "queryAuditId");

  try {
    const intent = await preparePullRequestIntent({
      workspaceId,
      repositoryId,
      title: getString(formData, "title"),
      targetBranch: getString(formData, "targetBranch"),
      problemStatement: getString(formData, "problemStatement"),
      riskSummary: getString(formData, "riskSummary"),
      validationChecklist: getString(formData, "validationChecklist")
        .split(/\r?\n/g)
        .map((item) => item.trim())
        .filter(Boolean),
      humanApproval: true,
    });

    revalidatePath(githubSettingsPath(workspaceId));
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        query,
        queryAuditId,
        intentId: intent.intentId,
        flash: "PR intent validated.",
        tone: "success",
      })
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(
      buildReturnPath(workspaceId, {
        repositoryId,
        query,
        queryAuditId,
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

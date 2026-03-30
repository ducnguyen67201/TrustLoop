"use server";

import {
  connectGithubInstallation,
  preparePullRequestIntent,
  recordSearchFeedback,
  requestRepositorySync,
  searchRepositoryCode,
  updateRepositorySelection,
} from "@shared/rest";
import { DEFAULT_WORKSPACE_ID } from "@shared/rest/codex";
import { ConflictError } from "@shared/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

const INTEGRATIONS_PATH = "/settings/integrations";

function buildReturnPath(params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `${INTEGRATIONS_PATH}?${query}` : INTEGRATIONS_PATH;
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
 * Connect the default workspace to the GitHub integration scaffold.
 */
export async function connectGithubAction(): Promise<never> {
  try {
    await connectGithubInstallation({
      workspaceId: DEFAULT_WORKSPACE_ID,
      installationOwner: "ducnguyen67201",
    });

    revalidatePath(INTEGRATIONS_PATH);
    redirect(buildReturnPath({ flash: "GitHub connected.", tone: "success" }));
  } catch (error) {
    redirect(buildReturnPath({ flash: getActionErrorMessage(error), tone: "error" }));
  }
}

/**
 * Toggle whether a repository is part of the indexed scope.
 */
export async function toggleRepositorySelectionAction(formData: FormData): Promise<never> {
  const repositoryId = getString(formData, "repositoryId");
  const selected = getString(formData, "selected") === "true";

  try {
    await updateRepositorySelection({
      workspaceId: DEFAULT_WORKSPACE_ID,
      repositoryId,
      selected,
    });

    revalidatePath(INTEGRATIONS_PATH);
    redirect(
      buildReturnPath({
        repositoryId,
        flash: selected ? "Repository added to scope." : "Repository removed from scope.",
        tone: "success",
      })
    );
  } catch (error) {
    redirect(
      buildReturnPath({
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
  const repositoryId = getString(formData, "repositoryId");

  try {
    await requestRepositorySync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      repositoryId,
      triggerSource: "manual",
    });

    revalidatePath(INTEGRATIONS_PATH);
    redirect(
      buildReturnPath({
        repositoryId,
        flash: "Sync queued on the codex worker.",
        tone: "success",
      })
    );
  } catch (error) {
    redirect(
      buildReturnPath({
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
  const repositoryId = getString(formData, "repositoryId");
  const query = getString(formData, "query");

  try {
    const result = await searchRepositoryCode({
      workspaceId: DEFAULT_WORKSPACE_ID,
      repositoryId,
      query,
      limit: 5,
    });

    revalidatePath(INTEGRATIONS_PATH);
    redirect(
      buildReturnPath({
        repositoryId,
        query,
        queryAuditId: result.queryAuditId,
        flash: "Evidence refreshed.",
        tone: "success",
      })
    );
  } catch (error) {
    redirect(
      buildReturnPath({
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
  const repositoryId = getString(formData, "repositoryId");
  const query = getString(formData, "query");
  const queryAuditId = getString(formData, "queryAuditId");

  try {
    await recordSearchFeedback({
      workspaceId: DEFAULT_WORKSPACE_ID,
      queryAuditId,
      searchResultId: getString(formData, "searchResultId"),
      label: getString(formData, "label") === "useful" ? "useful" : "off_target",
      note: undefined,
    });

    revalidatePath(INTEGRATIONS_PATH);
    redirect(
      buildReturnPath({
        repositoryId,
        query,
        queryAuditId,
        flash: "Feedback stored.",
        tone: "success",
      })
    );
  } catch (error) {
    redirect(
      buildReturnPath({
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
  const repositoryId = getString(formData, "repositoryId");
  const query = getString(formData, "query");
  const queryAuditId = getString(formData, "queryAuditId");

  try {
    const intent = await preparePullRequestIntent({
      workspaceId: DEFAULT_WORKSPACE_ID,
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

    revalidatePath(INTEGRATIONS_PATH);
    redirect(
      buildReturnPath({
        repositoryId,
        query,
        queryAuditId,
        intentId: intent.intentId,
        flash: "PR intent validated.",
        tone: "success",
      })
    );
  } catch (error) {
    redirect(
      buildReturnPath({
        repositoryId,
        query,
        queryAuditId,
        flash: getActionErrorMessage(error),
        tone: "error",
      })
    );
  }
}

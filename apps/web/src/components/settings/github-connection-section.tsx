import {
  syncRepositoryAction,
  toggleRepositorySelectionAction,
} from "@/app/[workspaceId]/settings/github/actions";
import { AddRepositoryCombobox } from "@/components/settings/add-repository-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GithubConnectionSummary, RepositorySummary } from "@shared/types";
import { RiGithubLine, RiRefreshLine, RiDeleteBinLine } from "@remixicon/react";
import Link from "next/link";

/** Status badge for indexed repos. */
function StatusBadge({ repo }: { repo: RepositorySummary }) {
  const s = repo.indexHealth.status;
  if (s === "ready")
    return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800">Synced</Badge>;
  if (s === "syncing")
    return <Badge variant="secondary">Syncing...</Badge>;
  if (s === "stale")
    return <Badge className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">Outdated</Badge>;
  if (s === "error")
    return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Needs sync</Badge>;
}

/**
 * Unified GitHub settings: connect, view indexed repos, add/remove, trigger sync.
 */
export function GitHubConnectionSection({
  workspaceId,
  connection,
  installUrl,
  repositories,
}: {
  workspaceId: string;
  connection: GithubConnectionSummary;
  installUrl: string | null;
  repositories: RepositorySummary[];
}) {
  const connected = connection.status === "connected";
  const indexed = repositories.filter((r) => r.selected);
  const available = repositories.filter((r) => !r.selected);

  if (!connected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <RiGithubLine className="size-6" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">Connect your GitHub account</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Choose which repositories TrustLoop can read to index code and prepare fixes.
            </p>
          </div>
          {installUrl ? (
            <Button asChild>
              <Link href={installUrl}>
                <RiGithubLine className="size-4" />
                Connect GitHub
              </Link>
            </Button>
          ) : (
            <>
              <Button disabled>Connect GitHub</Button>
              <p className="text-xs text-muted-foreground">
                GitHub App is not configured. Set GITHUB_APP_SLUG in your environment.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Repositories</CardTitle>
            <CardDescription>
              Connected as{" "}
              <span className="font-medium text-foreground">{connection.installationOwner}</span>.
              {" "}Select repositories to index for code search and PR prep.
            </CardDescription>
          </div>
          <Badge variant="default">Connected</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Indexed repositories */}
        {indexed.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No repositories indexed yet. Add one below to get started.
          </p>
        ) : (
          <div className="divide-y">
            {indexed.map((repo) => {
              const syncing = repo.indexHealth.status === "syncing";
              return (
                <div
                  key={repo.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RiGithubLine className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{repo.fullName}</p>
                        <StatusBadge repo={repo} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {repo.defaultBranch}
                        {repo.indexHealth.lastCompletedAt
                          ? ` · last synced ${new Date(repo.indexHealth.lastCompletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                          : null}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <form action={syncRepositoryAction}>
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="repositoryId" value={repo.id} />
                      <Button type="submit" variant="ghost" size="sm" disabled={syncing} title="Sync now">
                        <RiRefreshLine className={`size-4 ${syncing ? "animate-spin" : ""}`} />
                      </Button>
                    </form>
                    <form action={toggleRepositorySelectionAction}>
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="repositoryId" value={repo.id} />
                      <input type="hidden" name="selected" value="false" />
                      <Button type="submit" variant="ghost" size="sm" title="Remove from index">
                        <RiDeleteBinLine className="size-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add repository + manage access */}
        <div className="flex items-center gap-3 border-t pt-4">
          {available.length > 0 ? (
            <AddRepositoryCombobox workspaceId={workspaceId} available={available} />
          ) : null}
          {installUrl ? (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
              <Link href={installUrl}>
                {available.length > 0 ? "Manage access" : "Add repos from GitHub"}
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

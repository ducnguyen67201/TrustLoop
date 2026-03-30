import { toggleRepositorySelectionAction } from "@/app/settings/integrations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RepositorySummary } from "@shared/types";

/**
 * Keep repository selection explicit and narrow so the first indexing pass stays trustworthy.
 */
export function RepositoryScopeSection({
  workspaceId,
  repositories,
}: {
  workspaceId: string;
  repositories: RepositorySummary[];
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Repository Scope</CardTitle>
        <CardDescription>
          Choose the repositories your team actually supports. Start with the repos tied to
          customer-facing work and expand later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {repositories.length === 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Connect GitHub before selecting repositories.</p>
            <p className="text-sm text-muted-foreground">
              The repository catalog is seeded after installation so the indexing flow has a real
              target.
            </p>
          </div>
        ) : (
          repositories.map((repository) => (
            <div
              key={repository.id}
              className="flex flex-col gap-3 border-b border-border/70 pb-4 last:border-b-0 last:pb-0 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{repository.fullName}</p>
                  <Badge variant={repository.selected ? "default" : "secondary"}>
                    {repository.selected ? "IN SCOPE" : "OUT OF SCOPE"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Branch policy:{" "}
                  <span className="font-medium text-foreground">
                    {repository.branchPolicy === "default_branch_only"
                      ? `Default branch (${repository.defaultBranch})`
                      : "Workspace-selected branch"}
                  </span>
                </p>
              </div>
              <form action={toggleRepositorySelectionAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="repositoryId" value={repository.id} />
                <input
                  type="hidden"
                  name="selected"
                  value={repository.selected ? "false" : "true"}
                />
                <Button type="submit" variant={repository.selected ? "outline" : "default"}>
                  {repository.selected ? "Remove from index" : "Add to index"}
                </Button>
              </form>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

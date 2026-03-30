import { searchEvidenceAction, syncRepositoryAction } from "@/app/settings/integrations/actions";
import { EvidenceResults } from "@/components/settings/evidence-results";
import { PrIntentForm } from "@/components/settings/pr-intent-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { RepositorySummary, SearchCodeResponse } from "@shared/types";

type PreparedIntent = Awaited<ReturnType<typeof import("@shared/rest").getPreparedPrIntent>>;

/**
 * Combine repository health, sync control, evidence retrieval, and PR gating into one working area.
 */
export function IndexHealthSection({
  repositories,
  activeRepository,
  query,
  receipt,
  preparedIntent,
}: {
  repositories: RepositorySummary[];
  activeRepository: RepositorySummary | null;
  query: string;
  receipt: SearchCodeResponse | null;
  preparedIntent: PreparedIntent;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Index Health</CardTitle>
        <CardDescription>
          Show the current snapshot, allow manual sync, then move straight into evidence retrieval
          and PR prep without leaving the page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {repositories.length === 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Connect GitHub before checking repository health.
              </p>
              <p className="text-sm text-muted-foreground">
                The health model activates after you connect and choose at least one repository.
              </p>
            </div>
          ) : (
            repositories.map((repository) => (
              <div
                key={repository.id}
                className="flex flex-col gap-3 border-b border-border/70 pb-4 last:border-b-0 last:pb-0 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{repository.fullName}</p>
                    <Badge
                      variant={repository.indexHealth.status === "ready" ? "default" : "secondary"}
                    >
                      {repository.indexHealth.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {repository.indexHealth.activeCommitSha
                      ? `Active commit ${repository.indexHealth.activeCommitSha}`
                      : "No active snapshot yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {repository.indexHealth.lastCompletedAt
                      ? `Last completed ${repository.indexHealth.lastCompletedAt}`
                      : "Run your first sync to make this repo searchable."}
                  </p>
                  {repository.indexHealth.lastErrorMessage ? (
                    <p className="text-sm text-destructive">
                      {repository.indexHealth.lastErrorMessage}
                    </p>
                  ) : null}
                </div>
                <form action={syncRepositoryAction}>
                  <input type="hidden" name="repositoryId" value={repository.id} />
                  <Button type="submit" disabled={!repository.selected}>
                    Sync now
                  </Button>
                </form>
              </div>
            ))
          )}
        </div>
        <Separator />
        <div className="space-y-4">
          <form
            action={searchEvidenceAction}
            className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end"
          >
            <label className="grid gap-2 text-sm" htmlFor="search-query">
              <span className="font-medium">Issue or symptom</span>
              <Input
                id="search-query"
                name="query"
                defaultValue={query}
                placeholder="Search by error, subsystem, customer symptom, or file path"
                required
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="search-repository">
              <span className="font-medium">Repository</span>
              <select
                id="search-repository"
                name="repositoryId"
                defaultValue={activeRepository?.id}
                className="h-9 rounded-sm border border-input bg-background px-3 text-sm"
              >
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.fullName}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={!activeRepository?.selected}>
              Search evidence
            </Button>
          </form>
          <EvidenceResults
            repositoryId={activeRepository?.id ?? ""}
            query={query}
            receipt={receipt}
          />
        </div>
        <Separator />
        <PrIntentForm
          repository={activeRepository}
          query={query}
          queryAuditId={receipt?.queryAuditId ?? null}
          preparedIntent={preparedIntent}
        />
      </CardContent>
    </Card>
  );
}

import { preparePrIntentAction } from "@/app/[workspaceId]/settings/github/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RepositorySummary } from "@shared/types";

type PreparedIntent = Awaited<ReturnType<typeof import("@shared/rest").getPreparedPrIntent>>;

/**
 * Keep PR prep explicit, human-approved, and blocked when repository freshness falls below the bar.
 */
export function PrIntentForm({
  workspaceId,
  repository,
  query,
  queryAuditId,
  preparedIntent,
}: {
  workspaceId: string;
  repository: RepositorySummary | null;
  query: string;
  queryAuditId: string | null;
  preparedIntent: PreparedIntent;
}) {
  if (!repository) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>PR Intent</CardTitle>
        <CardDescription>
          Human approval is required before PR generation. This form only validates the intent and
          records the target branch, risk summary, and checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={preparePrIntentAction} className="space-y-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="repositoryId" value={repository.id} />
          <input type="hidden" name="query" value={query} />
          <input type="hidden" name="queryAuditId" value={queryAuditId ?? ""} />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm" htmlFor="pr-intent-title">
              <span className="font-medium">Intent title</span>
              <Input
                id="pr-intent-title"
                name="title"
                placeholder="Fix stale customer entitlement check"
                required
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="pr-intent-branch">
              <span className="font-medium">Target branch</span>
              <Input
                id="pr-intent-branch"
                name="targetBranch"
                defaultValue={repository.defaultBranch}
                placeholder={repository.defaultBranch}
                required
              />
            </label>
          </div>
          <label className="grid gap-2 text-sm" htmlFor="pr-intent-problem">
            <span className="font-medium">Problem statement</span>
            <Textarea
              id="pr-intent-problem"
              name="problemStatement"
              rows={4}
              placeholder="Describe what the customer hit, where the likely fault is, and why this change should be made now."
              required
            />
          </label>
          <label className="grid gap-2 text-sm" htmlFor="pr-intent-risk">
            <span className="font-medium">Risk summary</span>
            <Textarea
              id="pr-intent-risk"
              name="riskSummary"
              rows={3}
              placeholder="Describe blast radius, rollback expectations, and what could go wrong."
              required
            />
          </label>
          <label className="grid gap-2 text-sm" htmlFor="pr-intent-checklist">
            <span className="font-medium">Validation checklist</span>
            <Textarea
              id="pr-intent-checklist"
              name="validationChecklist"
              rows={4}
              placeholder={
                "Run failing scenario\nCheck affected integration path\nVerify no regression on happy path"
              }
              required
            />
          </label>
          <Button type="submit">Validate PR intent</Button>
        </form>
        {preparedIntent ? (
          <div className="rounded-sm border border-border/70 bg-muted/40 p-4 text-sm">
            <p className="font-medium">Latest validated intent: {preparedIntent.title}</p>
            <p className="text-muted-foreground">
              Target branch {preparedIntent.targetBranch} for {preparedIntent.repository.fullName}.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

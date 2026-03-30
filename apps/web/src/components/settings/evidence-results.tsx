import { submitFeedbackAction } from "@/app/settings/integrations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SearchCodeResponse } from "@shared/types";

/**
 * Render persisted search receipts so operators can inspect why a code result ranked highly.
 */
export function EvidenceResults({
  repositoryId,
  query,
  receipt,
}: {
  repositoryId: string;
  query: string;
  receipt: SearchCodeResponse | null;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Search Evidence</CardTitle>
        <CardDescription>
          Ranked evidence is persisted with score components so you can explain why result one beat
          result two.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!receipt ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Run your first sync to make this repo searchable.</p>
            <p className="text-sm text-muted-foreground">
              Once indexing finishes, TrustLoop will show file path, line span, freshness, and score
              receipts for every result.
            </p>
          </div>
        ) : receipt.results.length === 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">No matching code found for this issue.</p>
            <p className="text-sm text-muted-foreground">
              Try a more specific symptom, file name, error string, or affected subsystem.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {receipt.results.map((result, index) => (
              <div
                key={result.resultId}
                className="space-y-3 border-b border-border/70 pb-4 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">#{index + 1}</Badge>
                      <span className="font-medium">{result.filePath}</span>
                      <span className="text-sm text-muted-foreground">
                        lines {result.lineStart}-{result.lineEnd}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Freshness:{" "}
                      <span className="font-medium text-foreground">{result.freshnessStatus}</span>
                      {result.commitSha ? `  |  commit ${result.commitSha}` : ""}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    merged {result.scoreBreakdown.mergedScore.toFixed(2)}
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-sm bg-muted/60 p-3 text-xs leading-6 text-foreground">
                  {result.snippet}
                </pre>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>keyword {result.scoreBreakdown.keywordScore.toFixed(2)}</span>
                  <span>semantic {result.scoreBreakdown.semanticScore.toFixed(2)}</span>
                  <span>path {result.scoreBreakdown.pathScore.toFixed(2)}</span>
                  <span>freshness {result.scoreBreakdown.freshnessScore.toFixed(2)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={submitFeedbackAction}>
                    <input type="hidden" name="repositoryId" value={repositoryId} />
                    <input type="hidden" name="query" value={query} />
                    <input type="hidden" name="queryAuditId" value={receipt.queryAuditId} />
                    <input type="hidden" name="searchResultId" value={result.resultId} />
                    <input type="hidden" name="label" value="useful" />
                    <Button type="submit" size="sm" variant="outline">
                      Mark useful
                    </Button>
                  </form>
                  <form action={submitFeedbackAction}>
                    <input type="hidden" name="repositoryId" value={repositoryId} />
                    <input type="hidden" name="query" value={query} />
                    <input type="hidden" name="queryAuditId" value={receipt.queryAuditId} />
                    <input type="hidden" name="searchResultId" value={result.resultId} />
                    <input type="hidden" name="label" value="off_target" />
                    <Button type="submit" size="sm" variant="ghost">
                      Mark off-target
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

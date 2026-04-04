import { connectGithubAction } from "@/app/[workspaceId]/settings/github/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GithubConnectionSummary } from "@shared/types";

/**
 * Explain connection state and let the user establish the GitHub installation.
 */
export function GitHubConnectionSection({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: GithubConnectionSummary;
}) {
  const connected = connection.status === "connected";

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Connection Status</CardTitle>
            <CardDescription>
              TrustLoop uses your selected repositories to explain incidents faster and prepare safe
              fixes.
            </CardDescription>
          </div>
          <Badge variant={connected ? "default" : "secondary"}>
            {connected ? "CONNECTED" : "DISCONNECTED"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Installation owner:{" "}
              <span className="font-medium text-foreground">{connection.installationOwner}</span>
            </p>
            <p>
              Connected at:{" "}
              <span className="font-medium text-foreground">{connection.connectedAt}</span>
            </p>
            <p>Permissions look complete for the first indexing wedge.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Connect GitHub to start building your code knowledge base.
              </p>
              <p className="text-sm text-muted-foreground">
                TrustLoop uses the selected repositories in your workspace to ground evidence and
                keep PR prep gated on fresh code.
              </p>
            </div>
            <form action={connectGithubAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <Button type="submit">Connect GitHub</Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

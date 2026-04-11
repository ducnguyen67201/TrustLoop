import { SessionsList } from "@/components/session-replay/sessions-list";
import { Badge } from "@/components/ui/badge";

/**
 * Workspace-scoped session replay overview.
 * Lists every captured browser session for the workspace and opens the replay
 * modal for rows that have rrweb data attached.
 */
export default async function WorkspaceSessionsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <div className="w-full p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 border-b pb-4 md:flex-row md:items-baseline md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Sessions</h1>
          <p className="text-muted-foreground text-sm">
            Every browser session captured by the TrustLoop AI SDK.
          </p>
        </div>
        <Badge variant="outline" className="w-fit font-mono text-xs">
          Workspace {workspaceId}
        </Badge>
      </div>
      <SessionsList />
    </div>
  );
}

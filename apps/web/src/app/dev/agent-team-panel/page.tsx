import { AgentTeamPanel } from "@/components/support/agent-team-panel";
import { notFound } from "next/navigation";

/**
 * Dev-only preview page used by browser E2E to exercise the live agent-team panel
 * without requiring workspace auth.
 */
export default function AgentTeamPanelPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Agent Team Panel Preview</h1>
          <p className="text-sm text-muted-foreground">
            Exercise the live addressed-dialogue panel in isolation.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <AgentTeamPanel conversationId="conversation_preview" workspaceId="workspace_preview" />
        </div>
      </div>
    </main>
  );
}

"use client";

import { AgentTeamPanel } from "@/components/support/agent-team-panel";
import { ConversationPropertiesSidebar } from "@/components/support/conversation-properties-sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UseSessionReplayResult } from "@/hooks/use-session-replay";
import type {
  SupportAnalysisWithRelations,
  SupportConversation,
  SupportConversationStatus,
  SupportConversationTimelineEvent,
} from "@shared/types";

interface ConversationInsightsPanelProps {
  analysis: SupportAnalysisWithRelations | null;
  analysisError: string | null;
  conversation: SupportConversation;
  events: SupportConversationTimelineEvent[];
  isAnalyzing: boolean;
  isAnalysisMutating: boolean;
  isMutating: boolean;
  onApproveDraft: (draftId: string, editedBody?: string) => void;
  onAssign: (conversationId: string, assigneeUserId: string | null) => Promise<unknown>;
  onDismissDraft: (draftId: string, reason?: string) => void;
  onTriggerAnalysis: () => void;
  onUpdateStatus: (conversationId: string, status: SupportConversationStatus) => Promise<unknown>;
  sessionReplay: UseSessionReplayResult;
  workspaceId: string;
}

/**
 * Hosts secondary conversation tools in a tabbed right-hand panel.
 */
export function ConversationInsightsPanel(props: ConversationInsightsPanelProps) {
  return (
    <aside className="flex h-full w-full flex-col border-l">
      <Tabs defaultValue="properties" className="flex h-full flex-col">
        <div className="border-b px-4 py-3">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="agent-team">Agent Team</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="properties" className="mt-0 min-h-0 flex-1">
          <ConversationPropertiesSidebar {...props} />
        </TabsContent>

        <TabsContent value="agent-team" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden px-4 py-4">
            <div className="mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Agent Team
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Live addressed dialogue between specialist roles working on this thread.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <AgentTeamPanel
                conversationId={props.conversation.id}
                workspaceId={props.workspaceId}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

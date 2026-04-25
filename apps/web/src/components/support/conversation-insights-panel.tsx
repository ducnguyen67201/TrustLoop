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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const INSIGHTS_TAB = {
  properties: "properties",
  agentTeam: "agent-team",
} as const;
type InsightsTab = (typeof INSIGHTS_TAB)[keyof typeof INSIGHTS_TAB];

function isInsightsTab(value: string | null): value is InsightsTab {
  return value === INSIGHTS_TAB.properties || value === INSIGHTS_TAB.agentTeam;
}

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: InsightsTab = isInsightsTab(tabParam) ? tabParam : INSIGHTS_TAB.properties;

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === INSIGHTS_TAB.properties) {
        params.delete("tab");
      } else {
        params.set("tab", value);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <aside className="flex h-full w-full flex-col border-l">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex h-full flex-col">
        <div className="border-b px-4 py-3">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value={INSIGHTS_TAB.properties}>Properties</TabsTrigger>
            <TabsTrigger value={INSIGHTS_TAB.agentTeam}>Agent Team</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={INSIGHTS_TAB.properties} className="mt-0 min-h-0 flex-1">
          <ConversationPropertiesSidebar {...props} />
        </TabsContent>

        <TabsContent value={INSIGHTS_TAB.agentTeam} className="mt-0 min-h-0 flex-1 overflow-hidden">
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

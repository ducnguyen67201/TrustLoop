"use client";

import { SessionTab } from "@/components/session-replay/session-tab";
import { AnalysisPanel } from "@/components/support/analysis-panel";
import { SupportStatusBadge } from "@/components/support/support-status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuthSession } from "@/hooks/use-auth-session";
import type { UseSessionReplayResult } from "@/hooks/use-session-replay";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { RiCheckLine, RiFlashlightLine, RiUserSharedLine } from "@remixicon/react";
import {
  SUPPORT_CONVERSATION_STATUS,
  type SupportAnalysisWithRelations,
  type SupportConversation,
  type SupportConversationStatus,
  type SupportConversationTimelineEvent,
} from "@shared/types";

interface ConversationPropertiesSidebarProps {
  conversation: SupportConversation;
  events: SupportConversationTimelineEvent[];
  isMutating: boolean;
  onAssign: (conversationId: string, assigneeUserId: string | null) => Promise<unknown>;
  onUpdateStatus: (conversationId: string, status: SupportConversationStatus) => Promise<unknown>;

  analysis: SupportAnalysisWithRelations | null;
  isAnalyzing: boolean;
  isAnalysisMutating: boolean;
  analysisError: string | null;
  onTriggerAnalysis: () => void;
  onApproveDraft: (draftId: string, editedBody?: string) => void;
  onDismissDraft: (draftId: string, reason?: string) => void;
  workspaceId: string;

  sessionReplay: UseSessionReplayResult;
}

const STATUS_OPTIONS: Array<{ label: string; value: SupportConversationStatus }> = [
  { label: "Unread", value: SUPPORT_CONVERSATION_STATUS.unread },
  { label: "In Progress", value: SUPPORT_CONVERSATION_STATUS.inProgress },
  { label: "Done", value: SUPPORT_CONVERSATION_STATUS.done },
];

/**
 * Right-side properties panel for the two-panel conversation layout.
 * Shows assignee, status, AI analysis, and session replay in stacked sections.
 */
const ACTIVITY_EVENT_TYPES = new Set([
  "STATUS_CHANGED",
  "ASSIGNEE_CHANGED",
  "ANALYSIS_COMPLETED",
  "DRAFT_APPROVED",
  "DRAFT_DISMISSED",
  "MERGED",
  "SPLIT",
]);

function formatActivityTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ConversationPropertiesSidebar({
  conversation,
  events,
  isMutating,
  onAssign,
  onUpdateStatus,
  analysis,
  isAnalyzing,
  isAnalysisMutating,
  analysisError,
  onTriggerAnalysis,
  onApproveDraft,
  onDismissDraft,
  workspaceId,
  sessionReplay,
}: ConversationPropertiesSidebarProps) {
  const auth = useAuthSession();
  const { data: membersData } = useWorkspaceMembers();
  const members = membersData?.members ?? [];

  const assignedMember = members.find((m) => m.userId === conversation.assigneeUserId);
  const assigneeLabel = assignedMember
    ? assignedMember.userId === auth.session?.user.id
      ? `Me (${assignedMember.email})`
      : assignedMember.email
    : conversation.assigneeUserId
      ? "Unknown user"
      : "Unassigned";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* PROPERTIES heading */}
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Properties
        </h2>
      </div>

      <div className="space-y-4 px-5 pb-5">
        {/* Assignee */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Assignee</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={isMutating}
              >
                <RiUserSharedLine className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{assigneeLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => onAssign(conversation.id, null)}>
                <span className="flex-1">Unassigned</span>
                {!conversation.assigneeUserId && (
                  <RiCheckLine className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </DropdownMenuItem>
              {members.map((member) => (
                <DropdownMenuItem
                  key={member.userId}
                  onClick={() => onAssign(conversation.id, member.userId)}
                >
                  <span className="flex-1 truncate">
                    {member.userId === auth.session?.user.id
                      ? `Me (${member.email})`
                      : member.email}
                  </span>
                  {conversation.assigneeUserId === member.userId && (
                    <RiCheckLine className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Status</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={isMutating}
              >
                <SupportStatusBadge status={conversation.status} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => onUpdateStatus(conversation.id, opt.value)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator />

      {/* AI ANALYSIS */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI Analysis
          </h2>
          {analysis && !isAnalyzing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={isMutating || isAnalyzing}
              onClick={onTriggerAnalysis}
            >
              <RiFlashlightLine className="mr-1 h-3 w-3" />
              Re-run
            </Button>
          )}
        </div>
      </div>
      <div className="px-5 pb-4">
        <AnalysisPanel
          analysis={analysis}
          conversationId={conversation.id}
          workspaceId={workspaceId}
          isAnalyzing={isAnalyzing}
          onTriggerAnalysis={onTriggerAnalysis}
          onApproveDraft={onApproveDraft}
          onDismissDraft={onDismissDraft}
          isMutating={isMutating || isAnalysisMutating}
        />
        {analysisError && <p className="mt-2 text-xs text-destructive">{analysisError}</p>}
      </div>

      <Separator />

      {/* SESSION REPLAY */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Session
          </h2>
          {sessionReplay.hasSessionData && <span className="h-2 w-2 rounded-full bg-green-500" />}
        </div>
      </div>
      <div className="px-5 pb-4">
        <SessionTab
          workspaceId={workspaceId}
          isLoading={sessionReplay.isLoading}
          error={sessionReplay.error}
          match={sessionReplay.match}
          session={sessionReplay.session}
          supportEvidence={sessionReplay.supportEvidence}
          matchConfidence={sessionReplay.matchConfidence}
          events={sessionReplay.events}
          isLoadingEvents={sessionReplay.isLoadingEvents}
          failurePointId={sessionReplay.failurePointId}
          replayChunks={sessionReplay.replayChunks}
          totalReplayChunks={sessionReplay.totalReplayChunks}
          isLoadingReplayChunks={sessionReplay.isLoadingReplayChunks}
          replayLoadError={sessionReplay.replayLoadError}
          isAttachingSession={sessionReplay.isAttachingSession}
          attachSessionError={sessionReplay.attachSessionError}
          onAttachSession={sessionReplay.attachSession}
          onRetryReplayLoad={sessionReplay.retryReplayLoad}
          onLoadReplayChunks={sessionReplay.loadReplayChunks}
        />
      </div>

      <Separator />

      {/* ACTIVITY LOG */}
      <div className="px-5 pt-4 pb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Activity
        </h2>
      </div>
      <div className="px-5 pb-5">
        <ActivityLog events={events} />
      </div>
    </div>
  );
}

function ActivityLog({ events }: { events: SupportConversationTimelineEvent[] }) {
  const activityEvents = events.filter((e) => ACTIVITY_EVENT_TYPES.has(e.eventType)).reverse();

  if (activityEvents.length === 0) {
    return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div className="space-y-2">
      {activityEvents.map((event) => (
        <div key={event.id} className="flex items-start gap-2 text-xs">
          <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
          <div className="min-w-0 flex-1">
            <p className="text-foreground">
              {event.summary ?? event.eventType.replaceAll("_", " ")}
            </p>
            <p className="text-muted-foreground">{formatActivityTime(event.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

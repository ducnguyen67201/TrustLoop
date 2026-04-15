"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiRefreshLine, RiRobot2Line, RiSparklingLine } from "@remixicon/react";
import {
  AGENT_TEAM_OPEN_QUESTION_STATUS,
  AGENT_TEAM_RUN_STATUS,
  type AgentTeamDialogueMessage,
  type AgentTeamFact,
  type AgentTeamOpenQuestion,
  type AgentTeamRoleInbox,
  type AgentTeamRunSummary,
} from "@shared/types";
import type { ReactNode } from "react";

interface AgentTeamRunViewProps {
  error: string | null;
  isLoading: boolean;
  isMutating: boolean;
  isStreaming: boolean;
  onStartRun: () => void;
  run: AgentTeamRunSummary | null;
}

/**
 * Support-side collaboration panel for agent-team runs.
 * Shows addressed dialogue, inbox state, facts, and open questions in one place.
 */
export function AgentTeamRunView({
  error,
  isLoading,
  isMutating,
  isStreaming,
  onStartRun,
  run,
}: AgentTeamRunViewProps) {
  if (!run && isLoading) {
    return <p className="text-sm text-muted-foreground">Loading latest run…</p>;
  }

  if (!run) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Run the default agent team on this conversation to open the live collaboration thread.
        </p>
        <Button size="sm" onClick={onStartRun} disabled={isMutating}>
          <RiSparklingLine className="h-4 w-4" />
          Run default team
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  const messageCount = run.messages?.length ?? 0;
  const factCount = run.facts?.length ?? 0;
  const openQuestionCount =
    run.openQuestions?.filter(
      (question) => question.status === AGENT_TEAM_OPEN_QUESTION_STATUS.open
    ).length ?? 0;
  const inboxCount = run.roleInboxes?.length ?? 0;

  return (
    <div className="space-y-3" data-testid="agent-team-run-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={statusClassName(run.status)}>
              {run.status}
            </Badge>
            {isStreaming ? <span className="text-xs text-muted-foreground">Live</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {messageCount} messages · {factCount} facts · {openQuestionCount} open questions
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onStartRun}
          disabled={isMutating || isStreaming}
        >
          <RiRefreshLine className="h-4 w-4" />
          Re-run
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <MetricBadge label="Messages" value={messageCount} />
        <MetricBadge label="Facts" value={factCount} />
        <MetricBadge label="Questions" value={openQuestionCount} />
        <MetricBadge label="Inboxes" value={inboxCount} />
      </div>

      <Tabs defaultValue="chat" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="facts">Facts</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="inboxes">Inboxes</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-3">
          <ScrollArea className="h-80 rounded-md border border-border/50">
            <div className="space-y-3 p-3">
              {messageCount === 0 ? (
                <EmptyState
                  icon={<RiRobot2Line className="h-4 w-4" />}
                  title={isStreaming ? "Team is warming up" : "No dialogue yet"}
                  description={
                    isStreaming
                      ? "The orchestrator has started the run. Messages will appear here as roles wake up."
                      : "Start a run to see addressed role-to-role conversation."
                  }
                />
              ) : (
                run.messages?.map((message) => <MessageRow key={message.id} message={message} />)
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="facts" className="mt-3">
          <ScrollArea className="h-80 rounded-md border border-border/50">
            <div className="space-y-3 p-3">
              {factCount === 0 ? (
                <EmptyState
                  icon={<RiSparklingLine className="h-4 w-4" />}
                  title="No facts recorded"
                  description="Accepted facts will accumulate here as the team converges."
                />
              ) : (
                run.facts?.map((fact) => <FactRow key={fact.id} fact={fact} />)
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="questions" className="mt-3">
          <ScrollArea className="h-80 rounded-md border border-border/50">
            <div className="space-y-3 p-3">
              {run.openQuestions?.length ? (
                run.openQuestions.map((question) => (
                  <QuestionRow key={question.id} question={question} />
                ))
              ) : (
                <EmptyState
                  icon={<RiRobot2Line className="h-4 w-4" />}
                  title="No open questions"
                  description="Directed questions and blocking asks will appear here."
                />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="inboxes" className="mt-3">
          <ScrollArea className="h-80 rounded-md border border-border/50">
            <div className="space-y-3 p-3">
              {run.roleInboxes?.length ? (
                run.roleInboxes.map((inbox) => <InboxRow key={inbox.id} inbox={inbox} />)
              ) : (
                <EmptyState
                  icon={<RiRobot2Line className="h-4 w-4" />}
                  title="No mailbox state"
                  description="Mailbox scheduling state will appear here once the run starts."
                />
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MessageRow({ message }: { message: AgentTeamDialogueMessage }) {
  return (
    <div
      className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm"
      data-testid="agent-team-message"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">
            {message.kind.replaceAll("_", " ")}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {message.fromRoleLabel} → {message.toRoleSlug}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {formatTimestamp(message.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {message.subject}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
    </div>
  );
}

function FactRow({ fact }: { fact: AgentTeamFact }) {
  return (
    <div className="rounded-md border border-border/50 p-3 text-sm" data-testid="agent-team-fact">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">{fact.status}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {Math.round(fact.confidence * 100)}% confidence
        </span>
      </div>
      <p className="mt-2">{fact.statement}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Accepted by: {fact.acceptedBy.join(", ") || "nobody yet"}
      </p>
    </div>
  );
}

function QuestionRow({ question }: { question: AgentTeamOpenQuestion }) {
  return (
    <div
      className="rounded-md border border-border/50 p-3 text-sm"
      data-testid="agent-team-question"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">{question.status}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {question.askedByRoleSlug} → {question.ownerRoleSlug}
        </span>
      </div>
      <p className="mt-2">{question.question}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Blocking: {question.blockingRoles.join(", ") || "none"}
      </p>
    </div>
  );
}

function InboxRow({ inbox }: { inbox: AgentTeamRoleInbox }) {
  return (
    <div className="rounded-md border border-border/50 p-3 text-sm" data-testid="agent-team-inbox">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{inbox.roleSlug}</span>
        <Badge variant="outline" className={statusClassName(inbox.state)}>
          {inbox.state}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Unread {inbox.unreadCount} · Wake reason {inbox.wakeReason ?? "n/a"}
      </p>
    </div>
  );
}

function MetricBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function EmptyState({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
      <div className="rounded-full border border-border/50 p-2">{icon}</div>
      <p className="font-medium text-foreground">{title}</p>
      <p>{description}</p>
    </div>
  );
}

function statusClassName(status: string): string {
  if (status === AGENT_TEAM_RUN_STATUS.completed || status === "done" || status === "accepted") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === AGENT_TEAM_RUN_STATUS.failed || status === "blocked" || status === "rejected") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }

  if (status === AGENT_TEAM_RUN_STATUS.running || status === "running") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (status === AGENT_TEAM_RUN_STATUS.waiting || status === "queued" || status === "open") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

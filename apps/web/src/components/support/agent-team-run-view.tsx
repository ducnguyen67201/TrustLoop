"use client";

import { ResolutionPanel } from "@/components/support/resolution-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAgentRoleColorStyle,
  getAgentRoleTargetColorStyle,
} from "@/lib/agent-team/role-metadata";
import { RiRefreshLine, RiSparklingLine } from "@remixicon/react";
import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_OPEN_QUESTION_STATUS,
  AGENT_TEAM_RUN_STATUS,
  type AgentTeamDialogueMessage,
  type AgentTeamFact,
  type AgentTeamOpenQuestion,
  type AgentTeamRoleInbox,
  type AgentTeamRunSummary,
} from "@shared/types";
import { type ReactNode, useEffect, useMemo, useState } from "react";

interface AgentTeamRunViewProps {
  error: string | null;
  isLoading: boolean;
  isMutating: boolean;
  isStreaming: boolean;
  onStartRun: () => void;
  run: AgentTeamRunSummary | null;
}

// Operator-facing run view: role-prefixed transcript, per-role rollup strip,
// Raw transcript toggle for copy/paste. Honors DESIGN.md: mono-family only,
// no colored role badges, yellow reserved for the active role, calm layout.
export function AgentTeamRunView({
  error,
  isLoading,
  isMutating,
  isStreaming,
  onStartRun,
  run,
}: AgentTeamRunViewProps) {
  const [showAbs, setShowAbs] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  // Auto-focus the Resolve tab the first time a run lands in `waiting` —
  // that's the moment the operator needs to act. Subsequent tab clicks are
  // respected (no override loop).
  const [autoFocusedForRunId, setAutoFocusedForRunId] = useState<string | null>(null);
  useEffect(() => {
    if (run && run.status === AGENT_TEAM_RUN_STATUS.waiting && autoFocusedForRunId !== run.id) {
      setActiveTab("resolve");
      setAutoFocusedForRunId(run.id);
    }
  }, [run, autoFocusedForRunId]);

  const messages = run?.messages ?? [];
  const messageCount = messages.length;
  const factCount = run?.facts?.length ?? 0;
  const openQuestionCount =
    run?.openQuestions?.filter(
      (question) => question.status === AGENT_TEAM_OPEN_QUESTION_STATUS.open
    ).length ?? 0;
  const inboxCount = run?.roleInboxes?.length ?? 0;

  const startMs = messages[0]?.createdAt ? new Date(messages[0].createdAt).getTime() : null;
  const lastMs = messages.at(-1)?.createdAt
    ? new Date(messages.at(-1)?.createdAt ?? "").getTime()
    : null;
  const durationMs = startMs && lastMs ? Math.max(0, lastMs - startMs) : 0;

  const perRole = useMemo(() => computePerRoleRollup(messages), [messages]);
  const roleLabels = useMemo(() => buildRoleLabelMap(run), [run]);
  const activeRoleKey = isStreaming ? findActiveRoleKey(run?.roleInboxes ?? []) : null;
  const rawTranscript = useMemo(() => buildRawTranscript(messages), [messages]);

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

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 font-mono text-sm"
      data-testid="agent-team-run-panel"
    >
      {/* Summary strip — dense row per DESIGN.md, not a tile grid. */}
      <div className="space-y-2 rounded-md border border-border/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={`shrink-0 ${statusClassName(run.status)}`}>
            {run.status}
          </Badge>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              aria-pressed={showAbs}
              onClick={() => setShowAbs((v) => !v)}
            >
              {showAbs ? "abs" : "+rel"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onStartRun}
              disabled={isMutating}
            >
              <RiRefreshLine className="h-3.5 w-3.5" />
              Re-run
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          {isStreaming ? <span>live</span> : null}
          {isStreaming ? <span>·</span> : null}
          <span>{formatDuration(durationMs)}</span>
          <span>·</span>
          <span>{messageCount} turns</span>
          <span>·</span>
          <span>{factCount} facts</span>
          <span>·</span>
          <span>{openQuestionCount} open</span>
        </div>
        <p className="truncate text-[10px] text-muted-foreground/70" title={run.id}>
          {run.id}
        </p>
        {perRole.length > 0 ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-2 gap-y-0.5 text-xs">
            {perRole.map((row) => {
              const isActive = row.roleKey === activeRoleKey;
              return (
                <div className="contents" key={row.roleKey}>
                  <span
                    className={`min-w-0 truncate ${isActive ? "font-semibold text-primary" : "font-medium"}`}
                    style={isActive ? undefined : getAgentRoleColorStyle(row.roleKey)}
                    title={formatRoleRef(roleLabels, row.roleKey)}
                  >
                    {isActive ? "▸ " : ""}
                    {roleLabels.get(row.roleKey) ?? row.roleKey}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{row.turns}t</span>
                  <span className="text-muted-foreground tabular-nums">{row.toolCalls}x</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDuration(row.wallMs)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {row.firstAt != null ? `+${secs(row.firstAt)}s` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <TabsList className="grid w-full grid-cols-6 gap-0.5">
          <TabsTrigger value="chat" className="min-w-0 px-1 text-xs">
            Chat
          </TabsTrigger>
          <TabsTrigger value="raw" className="min-w-0 px-1 text-xs">
            Raw
          </TabsTrigger>
          <TabsTrigger
            value="resolve"
            aria-label="Resolve"
            className="min-w-0 px-1 text-xs data-[state=active]:text-amber-700"
          >
            Resolve
            {run.status === AGENT_TEAM_RUN_STATUS.waiting ? (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="facts" aria-label="Facts" className="min-w-0 px-1 text-xs">
            Facts
            <CountSuffix value={factCount} />
          </TabsTrigger>
          <TabsTrigger value="questions" aria-label="Questions" className="min-w-0 px-1 text-xs">
            Q&amp;A
            <CountSuffix value={openQuestionCount} />
          </TabsTrigger>
          <TabsTrigger value="inboxes" aria-label="Inboxes" className="min-w-0 px-1 text-xs">
            Inbox
            <CountSuffix value={inboxCount} />
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="chat"
          className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="h-full min-h-0 flex-1 rounded-md border border-border/50">
            <div className="space-y-1 p-3">
              {messageCount === 0 ? (
                <ChatEmptyState isStreaming={isStreaming} />
              ) : (
                messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    startMs={startMs}
                    showAbs={showAbs}
                    isActive={message.fromRoleKey === activeRoleKey}
                    roleLabels={roleLabels}
                  />
                ))
              )}
              {run.status === AGENT_TEAM_RUN_STATUS.failed ? (
                <FailureBlock errorMessage={run.errorMessage ?? null} />
              ) : null}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="raw"
          className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="h-full min-h-0 flex-1 rounded-md border border-border/50">
            <pre className="whitespace-pre-wrap p-3 text-xs leading-relaxed">
              {rawTranscript || "(empty transcript)"}
            </pre>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="resolve"
          className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="h-full min-h-0 flex-1 rounded-md border border-border/50">
            <div className="p-3">
              <ResolutionPanel runId={run.id} runStatus={run.status} roleLabels={roleLabels} />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="facts"
          className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="h-full min-h-0 flex-1 rounded-md border border-border/50">
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

        <TabsContent
          value="questions"
          className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="h-full min-h-0 flex-1 rounded-md border border-border/50">
            <div className="space-y-3 p-3">
              {run.openQuestions?.length ? (
                run.openQuestions.map((question) => (
                  <QuestionRow key={question.id} question={question} />
                ))
              ) : (
                <EmptyState
                  icon={<RiSparklingLine className="h-4 w-4" />}
                  title="No open questions"
                  description="Directed questions and blocking asks will appear here."
                />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="inboxes"
          className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="h-full min-h-0 flex-1 rounded-md border border-border/50">
            <div className="space-y-3 p-3">
              {run.roleInboxes?.length ? (
                run.roleInboxes.map((inbox) => <InboxRow key={inbox.id} inbox={inbox} />)
              ) : (
                <EmptyState
                  icon={<RiSparklingLine className="h-4 w-4" />}
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

function MessageRow({
  message,
  startMs,
  showAbs,
  isActive,
  roleLabels,
}: {
  message: AgentTeamDialogueMessage;
  startMs: number | null;
  showAbs: boolean;
  isActive: boolean;
  roleLabels: Map<string, string>;
}) {
  const isTool =
    message.kind === AGENT_TEAM_MESSAGE_KIND.toolCall ||
    message.kind === AGENT_TEAM_MESSAGE_KIND.toolResult;
  const ts = new Date(message.createdAt).getTime();
  const relSec = startMs ? Math.max(0, Math.round((ts - startMs) / 1000)) : 0;

  if (isTool) {
    return (
      <details
        className="ml-6 border-l border-border/50 pl-3 text-xs"
        data-testid="agent-team-tool-call"
      >
        <summary className="cursor-pointer py-1 text-muted-foreground">
          <span className="mr-2">▸</span>
          <span className="font-semibold">
            {message.kind === AGENT_TEAM_MESSAGE_KIND.toolCall ? "tool_call" : "tool_result"}
          </span>
          <span className="ml-2">{message.toolName ?? "(unnamed)"}</span>
          <span className="ml-2 text-muted-foreground/60">
            {showAbs ? formatAbs(message.createdAt) : `+${relSec}s`}
          </span>
        </summary>
        <pre className="whitespace-pre-wrap py-1 pl-4 text-muted-foreground">
          {formatToolMessageContent(message.content)}
        </pre>
      </details>
    );
  }

  return (
    <div
      className={`grid grid-cols-[auto_1fr] gap-x-3 py-1 ${
        isActive ? "border-l-2 border-primary pl-2" : "pl-[10px]"
      }`}
      data-testid="agent-team-message"
    >
      <span className="shrink-0 text-muted-foreground/70 tabular-nums">
        {showAbs ? formatAbs(message.createdAt) : `+${relSec}s`}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">[</span>
          <span className="font-semibold" style={getAgentRoleColorStyle(message.fromRoleKey)}>
            {formatRoleRef(roleLabels, message.fromRoleKey)}
          </span>
          <span> → </span>
          <span className="font-semibold" style={getAgentRoleTargetColorStyle(message.toRoleKey)}>
            {formatTargetRef(roleLabels, message.toRoleKey)}
          </span>
          <span className="font-semibold text-foreground">] </span>
          <span>({message.kind.replaceAll("_", " ")}):</span>
          <span className="ml-1 text-muted-foreground/70">{message.subject}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-foreground">{message.content}</p>
      </div>
    </div>
  );
}

function CountSuffix({ value }: { value: number }) {
  if (value <= 0) return null;
  return <span className="ml-1 text-muted-foreground">{value}</span>;
}

function ChatEmptyState({ isStreaming }: { isStreaming: boolean }) {
  if (isStreaming) {
    return (
      <p className="px-2 py-4 text-xs text-muted-foreground">
        Run queued. First role woken. Events arriving…
      </p>
    );
  }
  return (
    <p className="px-2 py-4 text-xs text-muted-foreground">
      No dialogue yet. Start a run to see addressed role-to-role conversation.
    </p>
  );
}

function FailureBlock({ errorMessage }: { errorMessage: string | null }) {
  return (
    <div
      className="mt-2 border-l-2 border-destructive/50 pl-2 text-xs"
      data-testid="agent-team-run-failure"
    >
      <div className="font-semibold text-destructive">[system] (error):</div>
      <p className="mt-0.5 whitespace-pre-wrap text-destructive">
        {errorMessage ?? "Run failed with no error message captured."}
      </p>
      <p className="mt-1 text-muted-foreground">Retry in Temporal UI.</p>
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
        Accepted by: {fact.acceptedByRoleKeys.join(", ") || "nobody yet"}
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
          {question.askedByRoleKey} → {question.ownerRoleKey}
        </span>
      </div>
      <p className="mt-2">{question.question}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Blocking: {question.blockingRoleKeys.join(", ") || "none"}
      </p>
    </div>
  );
}

function InboxRow({ inbox }: { inbox: AgentTeamRoleInbox }) {
  return (
    <div className="rounded-md border border-border/50 p-3 text-sm" data-testid="agent-team-inbox">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{inbox.roleKey}</span>
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

interface PerRoleRollup {
  roleKey: string;
  turns: number;
  toolCalls: number;
  wallMs: number;
  firstAt: number | null; // seconds since run start
}

// Derive a per-role rollup client-side from the message stream. Once commit 6
// lands and AgentTeamRun.summary is cached, this becomes a fallback for
// in-progress runs; completed runs read run.summary directly.
function computePerRoleRollup(messages: AgentTeamDialogueMessage[]): PerRoleRollup[] {
  if (messages.length === 0) return [];
  const startMs = new Date(messages[0]?.createdAt ?? 0).getTime();
  const byRole = new Map<
    string,
    { turns: number; toolCalls: number; last: number; first: number }
  >();
  for (const m of messages) {
    const t = new Date(m.createdAt).getTime();
    const row = byRole.get(m.fromRoleKey) ?? { turns: 0, toolCalls: 0, last: t, first: t };
    if (
      m.kind === AGENT_TEAM_MESSAGE_KIND.toolCall ||
      m.kind === AGENT_TEAM_MESSAGE_KIND.toolResult
    ) {
      row.toolCalls += 1;
    } else {
      row.turns += 1;
    }
    row.last = Math.max(row.last, t);
    row.first = Math.min(row.first, t);
    byRole.set(m.fromRoleKey, row);
  }
  return Array.from(byRole.entries()).map(([roleKey, row]) => ({
    roleKey,
    turns: row.turns,
    toolCalls: row.toolCalls,
    wallMs: Math.max(0, row.last - row.first),
    firstAt: startMs ? Math.max(0, Math.round((row.first - startMs) / 1000)) : null,
  }));
}

function findActiveRoleKey(inboxes: AgentTeamRoleInbox[]): string | null {
  return inboxes.find((i) => i.state === "running")?.roleKey ?? null;
}

function buildRawTranscript(messages: AgentTeamDialogueMessage[]): string {
  return messages
    .filter(
      (m) =>
        m.kind !== AGENT_TEAM_MESSAGE_KIND.toolCall && m.kind !== AGENT_TEAM_MESSAGE_KIND.toolResult
    )
    .map((m) => `(${m.fromRoleKey}) → (${m.toRoleKey}) [${m.kind}]  ${m.subject}\n${m.content}`)
    .join("\n\n");
}

function formatToolMessageContent(content: string): string {
  if (content.trim().length === 0) {
    return "(empty tool output)";
  }

  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "string" && parsed.trim().length === 0) {
      return "(empty tool output)";
    }
  } catch {
    return content;
  }

  return content;
}

function buildRoleLabelMap(run: AgentTeamRunSummary | null): Map<string, string> {
  if (!run) return new Map();
  return new Map(run.teamSnapshot.roles.map((role) => [role.roleKey, role.label]));
}

function formatRoleRef(roleLabels: Map<string, string>, roleKey: string): string {
  const label = roleLabels.get(roleKey);
  return label ? `${label} (${roleKey})` : roleKey;
}

function formatTargetRef(roleLabels: Map<string, string>, target: string): string {
  if (target === "broadcast" || target === "orchestrator") {
    return target;
  }

  return formatRoleRef(roleLabels, target);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function secs(n: number): number {
  return n;
}

function formatAbs(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
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

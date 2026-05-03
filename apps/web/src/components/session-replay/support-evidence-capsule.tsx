"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RiAlertLine, RiFileCopyLine, RiPlayCircleLine, RiShieldCheckLine } from "@remixicon/react";
import {
  SESSION_MATCH_CONFIDENCE,
  SESSION_REPLAY_MATCH_SOURCE,
  type SessionConversationMatch,
  type SessionMatchConfidence,
  type SessionRecordResponse,
  type SupportEvidence,
} from "@shared/types";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface SupportEvidenceCapsuleProps {
  isLoading: boolean;
  // True while a manual attach mutation is in flight. Treated as a loading
  // state so the capsule shows a skeleton instead of stale data while the
  // operator's attach choice is being persisted. Without this, clicking
  // "attach session" leaves the old "No browser session matched" card
  // visible until the mutation returns — which feels like the click did
  // nothing.
  isAttachingSession?: boolean;
  error: string | null;
  match: SessionConversationMatch | null;
  session: SessionRecordResponse | null;
  supportEvidence: SupportEvidence | null;
  matchConfidence: SessionMatchConfidence;
  manualAttachControl: ReactNode;
  canViewProof: boolean;
  onViewProof: (eventId?: string, timestamp?: string) => void;
}

interface EvidenceListItem {
  id: string;
  label: string;
  detail: string;
  timestamp: string | null;
  eventId: string | null;
  tone: "error" | "warning" | "info";
}

interface EvidenceLists {
  all: EvidenceListItem[];
  failures: EvidenceListItem[];
  requests: EvidenceListItem[];
  console: EvidenceListItem[];
}

// Operator-first evidence summary for a matched browser session.
export function SupportEvidenceCapsule({
  isLoading,
  isAttachingSession = false,
  error,
  match,
  session,
  supportEvidence,
  matchConfidence,
  manualAttachControl,
  canViewProof,
  onViewProof,
}: SupportEvidenceCapsuleProps) {
  const [copiedAction, setCopiedAction] = useState<"repro" | "escalation" | null>(null);
  const evidenceLists = useMemo(() => buildEvidenceLists(supportEvidence), [supportEvidence]);

  async function handleCopy(kind: "repro" | "escalation") {
    if (!supportEvidence) {
      return;
    }

    const body = withMatchContext(
      kind === "repro" ? supportEvidence.copy.repro : supportEvidence.copy.escalation,
      match,
      matchConfidence,
      session
    );
    setCopiedAction(kind);

    try {
      await navigator.clipboard.writeText(body);
      toast.success(kind === "repro" ? "Repro evidence copied." : "Escalation evidence copied.");
    } catch {
      toast.error("Clipboard write failed. Select the evidence text manually.");
    } finally {
      window.setTimeout(() => setCopiedAction(null), 1200);
    }
  }

  // isAttachingSession piggybacks on the loading skeleton so the operator
  // doesn't see stale "no session" copy during an attach mutation. The
  // aria-live label tells screen readers which kind of wait this is.
  if (isLoading || isAttachingSession) {
    const liveLabel = isAttachingSession ? "Attaching session" : "Loading session evidence";
    return (
      <Card size="sm" aria-busy="true" aria-live="polite" data-testid="capsule-loading">
        <span className="sr-only">{liveLabel}</span>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card size="sm" className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Session lookup failed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>No browser session matched</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">
            No captured browser session matched this support thread. Attach a recent session if the
            customer was using the product while they wrote in.
          </p>
          <div>{manualAttachControl}</div>
        </CardContent>
      </Card>
    );
  }

  const primary = supportEvidence?.primaryFailure ?? null;
  const isFuzzy = matchConfidence === SESSION_MATCH_CONFIDENCE.fuzzy;
  const isManual = match?.matchSource === SESSION_REPLAY_MATCH_SOURCE.manual;

  return (
    <Card size="sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <MatchBadge matchConfidence={matchConfidence} isManual={isManual} />
              {match ? <Badge variant="secondary">{matchSourceLabel(match)}</Badge> : null}
              {supportEvidence?.eventsWindow.isTruncated ? (
                <Badge variant="outline">
                  latest {supportEvidence.eventsWindow.returned} events
                </Badge>
              ) : null}
            </div>
            <CardTitle className="text-sm">Support evidence</CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {session.userEmail ?? session.userId ?? session.sessionId}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!supportEvidence}
              onClick={() => void handleCopy("repro")}
            >
              <RiFileCopyLine className="size-3.5" />
              {copiedAction === "repro" ? "Copied" : "Copy repro"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!supportEvidence}
              onClick={() => void handleCopy("escalation")}
            >
              <RiFileCopyLine className="size-3.5" />
              {copiedAction === "escalation" ? "Copied" : "Copy escalation"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canViewProof}
              onClick={() =>
                onViewProof(primary?.eventId ?? undefined, primary?.timestamp ?? undefined)
              }
            >
              <RiPlayCircleLine className="size-3.5" />
              View proof
            </Button>
            {manualAttachControl}
          </div>
        </div>
        {isFuzzy || isManual ? (
          <div
            className={cn(
              "border px-3 py-2 text-xs",
              isFuzzy ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"
            )}
          >
            {isFuzzy
              ? "Possible session evidence. Verify the match before quoting this in a reply."
              : "Operator-attached session. Treat this as selected evidence, not identity-confirmed proof."}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
          <div className="border p-3">
            <div className="mb-2 flex items-center gap-2">
              {primary?.severity === "error" ? (
                <RiAlertLine className="size-4 text-destructive" />
              ) : (
                <RiShieldCheckLine className="size-4 text-muted-foreground" />
              )}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Primary signal
              </h3>
            </div>
            <p className="text-sm font-medium">{primary?.title ?? "No captured failure"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {primary?.description ??
                "The latest captured events did not include an error signal."}
            </p>
          </div>
          <div className="border p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Session window
            </h3>
            <p className="text-xs">
              {supportEvidence
                ? `${supportEvidence.eventsWindow.returned} of ${supportEvidence.eventsWindow.total} events`
                : "No events loaded"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {supportEvidence?.lastRoute
                ? `Last route: ${supportEvidence.lastRoute}`
                : "No route captured"}
            </p>
          </div>
        </div>

        <Tabs defaultValue="all">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">All {evidenceLists.all.length}</TabsTrigger>
            <TabsTrigger value="failures">Failures {evidenceLists.failures.length}</TabsTrigger>
            <TabsTrigger value="requests">
              Failed fetches {evidenceLists.requests.length}
            </TabsTrigger>
            <TabsTrigger value="console">Console errors {evidenceLists.console.length}</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <EvidenceList
              items={evidenceLists.all}
              canViewProof={canViewProof}
              onViewProof={onViewProof}
            />
          </TabsContent>
          <TabsContent value="failures">
            <EvidenceList
              items={evidenceLists.failures}
              canViewProof={canViewProof}
              onViewProof={onViewProof}
            />
          </TabsContent>
          <TabsContent value="requests">
            <EvidenceList
              items={evidenceLists.requests}
              canViewProof={canViewProof}
              onViewProof={onViewProof}
            />
          </TabsContent>
          <TabsContent value="console">
            <EvidenceList
              items={evidenceLists.console}
              canViewProof={canViewProof}
              onViewProof={onViewProof}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function EvidenceList({
  items,
  canViewProof,
  onViewProof,
}: {
  items: EvidenceListItem[];
  canViewProof: boolean;
  onViewProof: (eventId?: string, timestamp?: string) => void;
}) {
  if (items.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">No evidence in this filter.</p>;
  }

  return (
    <ul className="divide-y border" aria-label="Session evidence">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:hover:bg-transparent"
            disabled={!canViewProof || !item.eventId || !item.timestamp}
            onClick={() => onViewProof(item.eventId ?? undefined, item.timestamp ?? undefined)}
          >
            <span
              className={cn(
                "mt-1 size-2 shrink-0 border",
                item.tone === "error"
                  ? "border-destructive bg-destructive"
                  : item.tone === "warning"
                    ? "border-primary bg-primary"
                    : "border-muted-foreground bg-muted-foreground"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
            </span>
            {item.timestamp ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatEvidenceTime(item.timestamp)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MatchBadge({
  matchConfidence,
  isManual,
}: {
  matchConfidence: SessionMatchConfidence;
  isManual: boolean;
}) {
  if (isManual) {
    return <Badge variant="outline">Manually attached</Badge>;
  }

  if (matchConfidence === SESSION_MATCH_CONFIDENCE.confirmed) {
    return <Badge variant="outline">Session matched</Badge>;
  }

  if (matchConfidence === SESSION_MATCH_CONFIDENCE.fuzzy) {
    return <Badge variant="outline">Possible match</Badge>;
  }

  return <Badge variant="outline">No match</Badge>;
}

function buildEvidenceLists(evidence: SupportEvidence | null): EvidenceLists {
  if (!evidence) {
    return { all: [], failures: [], requests: [], console: [] };
  }

  const primary = evidence.primaryFailure
    ? [
        {
          id: `primary-${evidence.primaryFailure.eventId ?? "none"}`,
          label: evidence.primaryFailure.title,
          detail: evidence.primaryFailure.description,
          timestamp: evidence.primaryFailure.timestamp,
          eventId: evidence.primaryFailure.eventId,
          tone: evidence.primaryFailure.severity,
        } satisfies EvidenceListItem,
      ]
    : [];
  const requests = evidence.failedRequests.map((request) => ({
    id: `request-${request.eventId}`,
    label: `${request.method} ${request.status}`,
    detail: request.description,
    timestamp: request.timestamp,
    eventId: request.eventId,
    tone: "error" as const,
  }));
  const consoleItems = evidence.consoleErrors.map((entry) => ({
    id: `console-${entry.eventId}`,
    label: entry.level,
    detail: entry.message,
    timestamp: entry.timestamp,
    eventId: entry.eventId,
    tone: entry.level === "WARN" ? ("warning" as const) : ("error" as const),
  }));
  const actions = evidence.lastActions.map((action) => ({
    id: `action-${action.eventId}`,
    label: action.type,
    detail: action.description,
    timestamp: action.timestamp,
    eventId: action.eventId,
    tone: "info" as const,
  }));
  const failures = [...primary, ...requests, ...consoleItems].filter(
    (item) => item.tone !== "info"
  );

  return {
    all: [...primary, ...actions, ...requests, ...consoleItems],
    failures,
    requests,
    console: consoleItems,
  };
}

function withMatchContext(
  body: string,
  match: SessionConversationMatch | null,
  matchConfidence: SessionMatchConfidence,
  session: SessionRecordResponse | null
): string {
  const matchLine = match
    ? `Match: ${matchConfidence} via ${matchSourceLabel(match)}`
    : `Match: ${matchConfidence}`;
  const identity = session?.userEmail ?? session?.userId ?? session?.sessionId ?? "unknown";
  return [`${matchLine}`, `Session: ${identity}`, body].join("\n");
}

function matchSourceLabel(match: SessionConversationMatch): string {
  switch (match.matchSource) {
    case SESSION_REPLAY_MATCH_SOURCE.userId:
      return "user ID";
    case SESSION_REPLAY_MATCH_SOURCE.conversationEmail:
      return "thread email";
    case SESSION_REPLAY_MATCH_SOURCE.slackProfileEmail:
      return "Slack profile";
    case SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail:
      return "message email";
    case SESSION_REPLAY_MATCH_SOURCE.manual:
      return "operator selection";
  }
}

function formatEvidenceTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

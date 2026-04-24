"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SESSION_MATCH_CONFIDENCE,
  SESSION_REPLAY_MATCH_SOURCE,
  type SessionBrief,
  type SessionConversationMatch,
  type SessionMatchConfidence,
} from "@shared/types";

interface SessionContextBarProps {
  isLoading: boolean;
  userEmail: string | null;
  duration: string | null;
  userAgent: string | null;
  match: SessionConversationMatch | null;
  sessionBrief: SessionBrief | null;
  matchConfidence: SessionMatchConfidence;
  error: string | null;
}

function browserLabel(userAgent: string): string {
  if (userAgent.includes("Chrome")) return "Chrome";
  if (userAgent.includes("Firefox")) return "Firefox";
  if (userAgent.includes("Safari")) return "Safari";
  if (userAgent.includes("Edge")) return "Edge";
  return "Browser";
}

function confidenceBadge(confidence: SessionMatchConfidence) {
  switch (confidence) {
    case SESSION_MATCH_CONFIDENCE.confirmed:
      return (
        <Badge variant="outline" className="border-green-600 text-green-700">
          Session matched
        </Badge>
      );
    case SESSION_MATCH_CONFIDENCE.fuzzy:
      return (
        <Badge variant="outline" className="border-yellow-600 text-yellow-700">
          Possible match
        </Badge>
      );
    case SESSION_MATCH_CONFIDENCE.none:
      return null;
  }
}

function matchSourceLabel(match: SessionConversationMatch | null): string | null {
  if (!match) {
    return null;
  }

  switch (match.matchSource) {
    case SESSION_REPLAY_MATCH_SOURCE.userId:
      return "Matched by user ID";
    case SESSION_REPLAY_MATCH_SOURCE.conversationEmail:
      return "Matched by thread email";
    case SESSION_REPLAY_MATCH_SOURCE.slackProfileEmail:
      return "Matched by Slack profile";
    case SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail:
      return "Matched by message email";
    case SESSION_REPLAY_MATCH_SOURCE.manual:
      return "Manually attached";
  }
}

/**
 * Context bar showing session match confidence, user info, duration, and browser.
 * Per DESIGN.md: "If a user can ask 'can I trust this result?', the answer should
 * already be visible in the UI."
 */
export function SessionContextBar({
  isLoading,
  userEmail,
  duration,
  userAgent,
  match,
  sessionBrief,
  matchConfidence,
  error,
}: SessionContextBarProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 border p-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">Session lookup failed</p>
      </div>
    );
  }

  if (matchConfidence === SESSION_MATCH_CONFIDENCE.none) {
    return (
      <div className="border p-3">
        <p className="text-muted-foreground text-sm">
          No matching session found for this thread yet. Matching requires a shared user ID or exact
          email signal from the conversation and the browser session.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {confidenceBadge(matchConfidence)}
        {matchSourceLabel(match) ? (
          <Badge variant="secondary">{matchSourceLabel(match)}</Badge>
        ) : null}
      </div>
      <p className="text-sm">
        <span className="font-medium">{userEmail}</span>
        {duration ? <span className="text-muted-foreground"> · {duration}</span> : null}
        {userAgent ? (
          <span className="text-muted-foreground"> · {browserLabel(userAgent)}</span>
        ) : null}
      </p>
      {sessionBrief ? (
        <div className="space-y-1">
          <p className="text-sm">{sessionBrief.headline}</p>
          {sessionBrief.bullets.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {sessionBrief.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

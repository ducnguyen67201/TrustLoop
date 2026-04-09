"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SESSION_MATCH_CONFIDENCE, type SessionMatchConfidence } from "@shared/types";

interface SessionContextBarProps {
  isLoading: boolean;
  userEmail: string | null;
  duration: string | null;
  userAgent: string | null;
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
          No matching session found. The end-user's email may not match this thread.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 border p-3">
      <div className="flex items-center gap-2">{confidenceBadge(matchConfidence)}</div>
      <p className="text-sm">
        <span className="font-medium">{userEmail}</span>
        {duration ? <span className="text-muted-foreground"> · {duration}</span> : null}
        {userAgent ? (
          <span className="text-muted-foreground"> · {browserLabel(userAgent)}</span>
        ) : null}
      </p>
    </div>
  );
}

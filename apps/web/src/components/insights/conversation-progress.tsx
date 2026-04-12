"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpcQuery } from "@/lib/trpc-http";
import type { SupportConversation, SupportConversationListResponse } from "@shared/types";
import { supportConversationStatusValues } from "@shared/types";
import { useEffect, useState } from "react";
import { SummaryCards } from "./summary-cards";
import { TimelineChart } from "./timeline-chart";
import { STATUS_STYLE } from "./timeline-utils";

const SKELETON_CARD_KEYS = ["sk-card-1", "sk-card-2", "sk-card-3", "sk-card-4"] as const;
const SKELETON_ROW_KEYS = [
  "sk-row-1",
  "sk-row-2",
  "sk-row-3",
  "sk-row-4",
  "sk-row-5",
  "sk-row-6",
] as const;

function StatusLegend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-4">
      {supportConversationStatusValues.map((status) => (
        <div key={status} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: STATUS_STYLE[status].colorVar }}
          />
          <span className="text-muted-foreground text-xs">{STATUS_STYLE[status].label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="h-3 w-px bg-primary/60" />
        <span className="text-muted-foreground text-xs">Now</span>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SKELETON_CARD_KEYS.map((key) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <Skeleton className="h-3 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          {SKELETON_ROW_KEYS.map((key) => (
            <Skeleton key={key} className="mb-2 h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function ConversationProgress() {
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await trpcQuery<SupportConversationListResponse, { limit: number }>(
          "supportInbox.listConversations",
          { limit: 200 }
        );
        if (!cancelled) setConversations(result.conversations);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Failed to load conversations");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) return <LoadingSkeleton />;

  if (loadError) {
    return <p className="text-destructive p-6 text-sm">{loadError}</p>;
  }

  return (
    <div className="space-y-4">
      <SummaryCards conversations={conversations} />
      <StatusLegend />
      <TimelineChart conversations={conversations} />
    </div>
  );
}

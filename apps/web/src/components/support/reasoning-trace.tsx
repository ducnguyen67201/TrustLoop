"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

interface EvidenceItem {
  id: string;
  sourceType: string;
  filePath: string | null;
  snippet: string | null;
  citation: string | null;
  createdAt: string;
}

interface ReasoningTraceProps {
  evidence: EvidenceItem[];
  reasoningTrace: string | null;
  toolCallCount: number | null;
  durationMs: number | null;
}

/**
 * Collapsible monospace timeline showing the agent's investigation steps.
 * Collapsed by default — the user expands to verify how the agent reached its conclusion.
 */
export function ReasoningTrace({
  evidence,
  reasoningTrace,
  toolCallCount,
  durationMs,
}: ReasoningTraceProps) {
  const [expanded, setExpanded] = useState(false);

  const durationLabel = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : "?s";
  const fileCount = new Set(evidence.map((e) => e.filePath).filter(Boolean)).size;

  return (
    <div className="mt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-muted-foreground font-mono px-2 h-7"
        aria-expanded={expanded}
        aria-controls="reasoning-trace-content"
      >
        {expanded ? "▾" : "▸"} Agent investigated {fileCount} file{fileCount !== 1 ? "s" : ""} (
        {durationLabel})
      </Button>

      {expanded && (
        <section
          id="reasoning-trace-content"
          aria-label="Agent reasoning trace"
          className="ml-4 mt-1 font-mono text-xs text-muted-foreground space-y-0.5"
        >
          {evidence.map((item, index) => (
            <div key={item.id} className="flex gap-1">
              <span className="text-muted-foreground/50 select-none">
                {index === evidence.length - 1 ? "└" : "├"}
              </span>
              <span>{item.citation ?? `Found ${item.filePath ?? "unknown"}`}</span>
            </div>
          ))}

          {reasoningTrace && (
            <div className="mt-2 pt-2 border-t border-border/50 text-muted-foreground/70">
              {reasoningTrace}
            </div>
          )}

          {toolCallCount !== null && (
            <div className="mt-1 text-muted-foreground/50">
              {toolCallCount} tool call{toolCallCount !== 1 ? "s" : ""}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

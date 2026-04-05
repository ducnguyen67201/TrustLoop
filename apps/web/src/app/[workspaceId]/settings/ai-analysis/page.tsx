"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { ANALYSIS_TRIGGER_MODE } from "@shared/types";
import { useState } from "react";

/**
 * AI Analysis settings page.
 *
 * Controls how TrustLoop analyzes support conversations:
 * - Trigger mode: AUTO (analyze after grouping window) or MANUAL (click to analyze)
 * - Provider: which LLM to use (future: provider picker)
 */
export default function AiAnalysisSettingsPage() {
  const { workspace } = useActiveWorkspace();
  const [triggerMode, setTriggerMode] = useState(
    (workspace as Record<string, unknown>)?.analysisTriggerMode ?? ANALYSIS_TRIGGER_MODE.auto
  );
  const [saving, setSaving] = useState(false);

  async function handleTriggerModeChange(value: string) {
    setTriggerMode(value);
    setSaving(true);
    try {
      // TODO: wire to tRPC mutation (updateWorkspaceSettings)
      // await trpc.workspace.updateAnalysisSettings.mutate({ triggerMode: value });
      console.log("TODO: save triggerMode", value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg font-semibold">AI Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Configure how TrustLoop analyzes support conversations and generates draft responses.
        </p>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="trigger-mode">Analysis trigger</Label>
          <p className="text-xs text-muted-foreground">
            Controls when TrustLoop automatically analyzes incoming conversations.
          </p>
          <Select value={triggerMode} onValueChange={handleTriggerModeChange} disabled={saving}>
            <SelectTrigger id="trigger-mode" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANALYSIS_TRIGGER_MODE.auto}>
                <div className="flex items-center gap-2">
                  Automatic
                  <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                    recommended
                  </Badge>
                </div>
              </SelectItem>
              <SelectItem value={ANALYSIS_TRIGGER_MODE.manual}>
                Manual
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 p-4 text-sm space-y-2">
          {triggerMode === ANALYSIS_TRIGGER_MODE.auto ? (
            <>
              <p className="font-medium">Automatic mode</p>
              <p className="text-muted-foreground">
                TrustLoop waits for the customer to stop sending messages (5 minute window),
                then automatically analyzes the conversation and generates a draft response.
                The draft appears in the inbox for your review.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Manual mode</p>
              <p className="text-muted-foreground">
                Click the "Analyze" button on each conversation to trigger analysis.
                No automatic analysis runs. Useful when you want full control over
                which conversations get analyzed.
              </p>
            </>
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>AI provider</Label>
          <p className="text-xs text-muted-foreground">
            Which AI model analyzes your conversations. More providers coming soon.
          </p>
          <Select value="openai" disabled>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI (GPT-4o)</SelectItem>
              <SelectItem value="anthropic" disabled>Anthropic (Claude) — coming soon</SelectItem>
              <SelectItem value="google" disabled>Google (Gemini) — coming soon</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

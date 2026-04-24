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
import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import {
  ANALYSIS_TRIGGER_MODE,
  type AnalysisTriggerMode,
  type WorkspaceDetailsResponse,
  type WorkspaceUpdateAnalysisSettingsResponse,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

export default function AiAnalysisSettingsPage() {
  const [triggerMode, setTriggerMode] = useState<AnalysisTriggerMode>(ANALYSIS_TRIGGER_MODE.auto);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpcQuery<WorkspaceDetailsResponse>("workspace.getDetails")
      .then((details) => {
        setTriggerMode(details.analysisTriggerMode);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleTriggerModeChange = useCallback(async (value: string) => {
    const mode = value as AnalysisTriggerMode;
    setTriggerMode(mode);
    setSaving(true);
    try {
      await trpcMutation<
        { triggerMode: AnalysisTriggerMode },
        WorkspaceUpdateAnalysisSettingsResponse
      >("workspace.updateAnalysisSettings", { triggerMode: mode }, { withCsrf: true });
    } catch {
      // Revert on failure — refetch the real value
      const details = await trpcQuery<WorkspaceDetailsResponse>("workspace.getDetails");
      setTriggerMode(details.analysisTriggerMode);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg font-semibold">AI Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Configure how TrustLoop AI analyzes support conversations and generates draft responses.
        </p>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="trigger-mode">Analysis trigger</Label>
          <p className="text-xs text-muted-foreground">
            Controls when TrustLoop AI automatically analyzes incoming conversations.
          </p>
          <Select
            value={triggerMode}
            onValueChange={handleTriggerModeChange}
            disabled={saving || loading}
          >
            <SelectTrigger id="trigger-mode" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANALYSIS_TRIGGER_MODE.auto}>
                <div className="flex items-center gap-2">
                  Automatic
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200"
                  >
                    recommended
                  </Badge>
                </div>
              </SelectItem>
              <SelectItem value={ANALYSIS_TRIGGER_MODE.manual}>Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border border-border/50 bg-muted/20 p-4 text-sm space-y-2">
          {triggerMode === ANALYSIS_TRIGGER_MODE.auto ? (
            <>
              <p className="font-medium">Automatic mode</p>
              <p className="text-muted-foreground">
                TrustLoop AI waits for the customer to stop sending messages (5 minute window), then
                automatically analyzes the conversation and generates a draft response. The draft
                appears in the inbox for your review.
              </p>
              <p className="text-muted-foreground">
                Changes take effect immediately for new messages. Conversations already waiting for
                the quiet window will respect the updated setting.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Manual mode</p>
              <p className="text-muted-foreground">
                Click the "Analyze" button on each conversation to trigger analysis. No automatic
                analysis runs. Useful when you want full control over which conversations get
                analyzed.
              </p>
              <p className="text-muted-foreground">
                Switching to manual stops future auto-analysis. Any conversation currently in the
                quiet window will not be auto-analyzed.
              </p>
            </>
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>AI routing</Label>
          <p className="text-xs text-muted-foreground">
            OpenAI is the default analysis provider. If OpenRouter is configured, TrustLoop uses it
            as the automatic fallback.
          </p>
          <Select value="openai" disabled>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI primary (GPT-4o)</SelectItem>
              <SelectItem value="openrouter" disabled>
                OpenRouter fallback (automatic)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

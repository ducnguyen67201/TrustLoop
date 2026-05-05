"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type { ListKnowledgeNotesOutput } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// /settings/knowledge
//
// Single-page admin surface for the workspace knowledge base v1. Two panels:
//   - Knowledge notes: paste a runbook chunk + title; embedded inline; list +
//     delete inline.
//   - Past resolutions: indexed-vs-candidate count + "Run backfill" button to
//     trigger the embedding workflow over historical approved drafts.
//
// Behind the per-workspace feature flag (Workspace.knowledgeSearchEnabled).
// Admin operators can flip the flag from the "Knowledge retrieval" card at the
// top of this page. Disabled workspaces incur zero retrieval or embedding cost.
// ---------------------------------------------------------------------------

type IndexedCounts = {
  notes: number;
  pastResolutions: number;
  pastResolutionCandidates: number;
};

const INITIAL_COUNTS: IndexedCounts = {
  notes: 0,
  pastResolutions: 0,
  pastResolutionCandidates: 0,
};

export default function KnowledgeSettingsPage() {
  const [counts, setCounts] = useState<IndexedCounts>(INITIAL_COUNTS);
  const [notes, setNotes] = useState<ListKnowledgeNotesOutput["notes"]>([]);
  const [enabled, setEnabledState] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Note editor local state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Backfill local state
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [countsResult, notesResult, enabledResult] = await Promise.all([
        trpcQuery<IndexedCounts>("workspaceKnowledge.getIndexedCounts"),
        trpcQuery<ListKnowledgeNotesOutput>("workspaceKnowledge.listNotes"),
        trpcQuery<boolean>("workspaceKnowledge.getEnabled"),
      ]);
      setCounts(countsResult);
      setNotes(notesResult.notes);
      setEnabledState(enabledResult);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load knowledge.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleEnabled = useCallback(async (next: boolean) => {
    setTogglingEnabled(true);
    setError(null);
    try {
      const result = await trpcMutation<{ enabled: boolean }, { enabled: boolean }>(
        "workspaceKnowledge.setEnabled",
        { enabled: next },
        { withCsrf: true }
      );
      setEnabledState(result.enabled);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update flag.";
      setError(message);
    } finally {
      setTogglingEnabled(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreateNote = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await trpcMutation<{ title: string; content: string }, { noteId: string }>(
        "workspaceKnowledge.createNote",
        { title: title.trim(), content: content.trim() },
        { withCsrf: true }
      );
      setTitle("");
      setContent("");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save note.";
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  }, [title, content, refresh]);

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      try {
        await trpcMutation<{ noteId: string }, { success: true }>(
          "workspaceKnowledge.deleteNote",
          { noteId },
          { withCsrf: true }
        );
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete note.";
        setError(message);
      }
    },
    [refresh]
  );

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillMessage(null);
    try {
      const result = await trpcMutation<
        { maxConversations?: number },
        { workflowId: string; runId: string }
      >("workspaceKnowledge.triggerBackfill", {}, { withCsrf: true });
      setBackfillMessage(`Backfill started — workflow ${result.workflowId}.`);
      // Allow a short delay before refreshing counts; the workflow runs async.
      setTimeout(() => {
        refresh();
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start backfill.";
      setBackfillMessage(`Error: ${message}`);
    } finally {
      setBackfilling(false);
    }
  }, [refresh]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const canSubmitNote = title.trim().length >= 3 && content.trim().length >= 20 && !creating;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <p className="text-sm text-muted-foreground">
          Operator-curated notes and past resolutions used to ground draft generation. The agent
          retrieves from these sources alongside indexed code when the workspace feature flag is on.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <p className="text-sm">{error}</p>
        </Alert>
      ) : null}

      <Card className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Knowledge retrieval</h2>
              <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "ON" : "OFF"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              When enabled, the agent draft prompt receives related notes, similar past resolutions,
              and indexed code. New approved drafts are also embedded automatically. Disabled
              workspaces incur zero retrieval or embedding cost.
            </p>
          </div>
          <Button
            variant={enabled ? "outline" : "default"}
            disabled={togglingEnabled}
            onClick={() => handleToggleEnabled(!enabled)}
          >
            {togglingEnabled ? "Saving…" : enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      </Card>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Knowledge notes</h2>
          <Badge variant="secondary">{counts.notes} indexed</Badge>
        </div>

        <Card className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="kb-note-title">Title</Label>
            <Input
              id="kb-note-title"
              placeholder="Refund policy, escalation rules, product naming…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={creating}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-note-content">Content (markdown)</Label>
            <Textarea
              id="kb-note-content"
              placeholder="Paste a runbook chunk, policy paragraph, or FAQ entry. Minimum 20 characters."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={16_000}
              rows={8}
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">{content.length} / 16000 characters</p>
          </div>
          {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
          <div className="flex justify-end">
            <Button onClick={handleCreateNote} disabled={!canSubmitNote}>
              {creating ? "Saving…" : "Add note"}
            </Button>
          </div>
        </Card>

        <div className="space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            notes.map((note) => (
              <Card key={note.id} className="space-y-2 p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-medium">{note.title}</h3>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteNote(note.id)}>
                    Delete
                  </Button>
                </div>
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {note.contentPreview}
                </p>
                <p className="text-xs text-muted-foreground">
                  Updated {new Date(note.updatedAt).toLocaleDateString()}
                </p>
              </Card>
            ))
          )}
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Past resolutions</h2>
          <Badge variant="secondary">
            {counts.pastResolutions} / {counts.pastResolutionCandidates} indexed
          </Badge>
        </div>

        <Card className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            Embeds approved Slack support replies as Q+A pairs for retrieval. Forward-flowing —
            every future approved draft is embedded automatically. Run backfill to embed existing
            approved drafts. Bounded concurrency keeps embedding-API load predictable.
          </p>
          {backfillMessage ? <p className="text-sm">{backfillMessage}</p> : null}
          <div className="flex justify-end">
            <Button
              onClick={handleBackfill}
              disabled={backfilling || counts.pastResolutionCandidates === 0}
            >
              {backfilling ? "Starting…" : "Run backfill"}
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}

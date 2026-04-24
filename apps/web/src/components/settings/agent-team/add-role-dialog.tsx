"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_PROVIDER,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TOOL_ID,
  type AddAgentTeamRoleInput,
} from "@shared/types";
import { type FormEvent, useState } from "react";

const ROLE_OPTIONS = [
  { value: AGENT_TEAM_ROLE_SLUG.architect, label: "Architect" },
  { value: AGENT_TEAM_ROLE_SLUG.reviewer, label: "Reviewer" },
  { value: AGENT_TEAM_ROLE_SLUG.codeReader, label: "Code Reader" },
  { value: AGENT_TEAM_ROLE_SLUG.prCreator, label: "PR Creator" },
  { value: AGENT_TEAM_ROLE_SLUG.rcaAnalyst, label: "RCA Analyst" },
] as const;

const TOOL_OPTIONS = [
  { value: AGENT_TEAM_TOOL_ID.searchCode, label: "Search code" },
  { value: AGENT_TEAM_TOOL_ID.searchSentry, label: "Search Sentry" },
  { value: AGENT_TEAM_TOOL_ID.createPullRequest, label: "Create pull request" },
] as const;

interface AddRoleDialogProps {
  teamId: string;
  onAddRole: (input: AddAgentTeamRoleInput) => Promise<void>;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Adds a specialized role to the selected agent team.
 */
export function AddRoleDialog({ teamId, onAddRole, triggerRef }: AddRoleDialogProps) {
  const defaultRole = ROLE_OPTIONS[0];
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState<(typeof ROLE_OPTIONS)[number]["value"]>(defaultRole.value);
  const [label, setLabel] = useState<string>(defaultRole.label);
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [maxSteps, setMaxSteps] = useState("8");
  const [toolIds, setToolIds] = useState<string[]>([AGENT_TEAM_TOOL_ID.searchCode]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateLabel(nextSlug: (typeof ROLE_OPTIONS)[number]["value"]) {
    setSlug(nextSlug);
    const match = ROLE_OPTIONS.find((option) => option.value === nextSlug);
    if (match) {
      setLabel(match.label);
    }
  }

  function toggleTool(toolId: string, checked: boolean) {
    setToolIds((current) =>
      checked ? [...new Set([...current, toolId])] : current.filter((value) => value !== toolId)
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setError(null);

    try {
      await onAddRole({
        teamId,
        slug,
        label,
        description: description || undefined,
        provider: AGENT_PROVIDER.openai,
        model: model || undefined,
        toolIds: toolIds as AddAgentTeamRoleInput["toolIds"],
        maxSteps: Number(maxSteps),
      });
      setOpen(false);
      setDescription("");
      setModel("");
      setMaxSteps("8");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "";
      setError(message || "Failed to add role");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button ref={triggerRef} variant="outline" size="sm">
          Add role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add role</DialogTitle>
          <DialogDescription>
            Choose a role type for the behavior preset, then use the label to name this agent
            however you want. The system will generate a separate internal routing key
            automatically.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="agent-role-slug">Role type</Label>
            <Select value={slug} onValueChange={updateLabel}>
              <SelectTrigger id="agent-role-slug">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Role type controls the agent behavior preset. Label is the display name shown in the
              team graph and run timeline.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-role-label">Label</Label>
            <Input
              id="agent-role-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-role-description">Description</Label>
            <Textarea
              id="agent-role-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-role-model">Model override</Label>
              <Input
                id="agent-role-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4o"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-role-max-steps">Max steps</Label>
              <Input
                id="agent-role-max-steps"
                value={maxSteps}
                onChange={(event) => setMaxSteps(event.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tools</Label>
            <div className="space-y-2 rounded-md border p-3">
              {TOOL_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`tool-${option.value}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <Checkbox
                    id={`tool-${option.value}`}
                    checked={toolIds.includes(option.value)}
                    onCheckedChange={(checked) => toggleTool(option.value, checked === true)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import type { AgentTeam, CreateAgentTeamInput } from "@shared/types";
import { type FormEvent, useState } from "react";

interface CreateTeamDialogProps {
  onCreate: (input: CreateAgentTeamInput) => Promise<AgentTeam>;
}

/**
 * Creates a new workspace agent team with a minimal name/description form.
 */
export function CreateTeamDialog({ onCreate }: CreateTeamDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onCreate({
        name,
        description: description || undefined,
      });
      setOpen(false);
      setName("");
      setDescription("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create team");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create agent team</DialogTitle>
          <DialogDescription>
            Start with a named team, then add specialist roles and handoffs.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="agent-team-name">Name</Label>
            <Input
              id="agent-team-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Backend Review Team"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-team-description">Description</Label>
            <Textarea
              id="agent-team-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Multi-role team for reproducing issues, validating fixes, and opening PRs."
              rows={4}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

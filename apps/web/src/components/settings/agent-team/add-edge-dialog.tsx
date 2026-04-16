"use client";

import { getRoleVisual } from "@/components/settings/agent-team/role-metadata";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiArrowRightSLine } from "@remixicon/react";
import type { AddAgentTeamEdgeInput, AgentTeam } from "@shared/types";
import { useMemo, useState } from "react";

interface AddEdgeDialogProps {
  team: AgentTeam;
  onAddEdge: (input: AddAgentTeamEdgeInput) => Promise<AgentTeam>;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Creates a directed connection between two existing roles.
 * Filters out already-connected pairs and self-connections.
 */
export function AddEdgeDialog({ team, onAddEdge, triggerRef }: AddEdgeDialogProps) {
  const orderedRoles = useMemo(() => team.roles, [team.roles]);
  const [open, setOpen] = useState(false);
  const [sourceRoleId, setSourceRoleId] = useState<string>(orderedRoles[0]?.id ?? "");
  const [targetRoleId, setTargetRoleId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const existingEdgeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const edge of team.edges) {
      keys.add(`${edge.sourceRoleId}:${edge.targetRoleId}`);
    }
    return keys;
  }, [team.edges]);

  const availableTargets = useMemo(() => {
    if (!sourceRoleId) return orderedRoles;
    return orderedRoles.filter((role) => {
      if (role.id === sourceRoleId) return false;
      return !existingEdgeKeys.has(`${sourceRoleId}:${role.id}`);
    });
  }, [sourceRoleId, orderedRoles, existingEdgeKeys]);

  const isDuplicate =
    sourceRoleId && targetRoleId ? existingEdgeKeys.has(`${sourceRoleId}:${targetRoleId}`) : false;

  const isSelfLoop = sourceRoleId === targetRoleId && sourceRoleId !== "";

  const sourceRole = orderedRoles.find((r) => r.id === sourceRoleId);
  const targetRole = orderedRoles.find((r) => r.id === targetRoleId);

  function handleSourceChange(value: string) {
    setSourceRoleId(value);
    setTargetRoleId("");
    setError(null);
  }

  function handleOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setSourceRoleId(orderedRoles[0]?.id ?? "");
      setTargetRoleId("");
      setError(null);
    }
  }

  async function handleSubmit() {
    if (isDuplicate || isSelfLoop || !sourceRoleId || !targetRoleId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onAddEdge({
        teamId: team.id,
        sourceRoleId,
        targetRoleId,
      });
      setOpen(false);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "";
      if (message.includes("already exists") || message.includes("Unique constraint")) {
        setError("This connection already exists.");
      } else if (message.includes("cycle") || message.includes("acyclic")) {
        setError("This connection would create a circular dependency.");
      } else {
        setError("Failed to add connection. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button ref={triggerRef} variant="outline" size="sm" disabled={orderedRoles.length < 2}>
          Add connection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>
            Allow one role to send messages to another. This enables direct communication between
            agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edge-source-role">From</Label>
            <Select value={sourceRoleId} onValueChange={handleSourceChange}>
              <SelectTrigger id="edge-source-role">
                <SelectValue placeholder="Select source role" />
              </SelectTrigger>
              <SelectContent>
                {orderedRoles.map((role) => {
                  const visual = getRoleVisual(role.slug);
                  return (
                    <SelectItem key={role.id} value={role.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: visual.color }}
                        />
                        {role.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edge-target-role">To</Label>
            <Select
              value={targetRoleId}
              onValueChange={(v) => {
                setTargetRoleId(v);
                setError(null);
              }}
            >
              <SelectTrigger id="edge-target-role">
                <SelectValue placeholder="Select target role" />
              </SelectTrigger>
              <SelectContent>
                {availableTargets.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    All roles are already connected from this source.
                  </div>
                ) : (
                  availableTargets.map((role) => {
                    const visual = getRoleVisual(role.slug);
                    return (
                      <SelectItem key={role.id} value={role.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: visual.color }}
                          />
                          {role.label}
                        </span>
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          {sourceRole && targetRole ? (
            <div className="flex items-center justify-center gap-2 py-3 px-4 border border-border bg-muted/30 text-sm">
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getRoleVisual(sourceRole.slug).color }}
                />
                <span className="font-medium">{sourceRole.label}</span>
              </span>
              <RiArrowRightSLine className="w-4 h-4 text-muted-foreground" />
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getRoleVisual(targetRole.slug).color }}
                />
                <span className="font-medium">{targetRole.label}</span>
              </span>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !sourceRoleId || !targetRoleId || isDuplicate || isSelfLoop}
          >
            {isSubmitting ? "Adding..." : "Add connection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

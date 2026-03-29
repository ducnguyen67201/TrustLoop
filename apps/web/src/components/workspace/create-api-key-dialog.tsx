"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiKeyExpiryDays, WorkspaceApiKeyCreateResponse } from "@shared/types";
import { useState } from "react";
import type { FormEvent } from "react";

interface CreateApiKeyDialogProps {
  onCreate: (input: {
    name: string;
    expiresInDays: ApiKeyExpiryDays;
  }) => Promise<WorkspaceApiKeyCreateResponse>;
}

const EXPIRY_OPTIONS: ApiKeyExpiryDays[] = [30, 60, 90];

/**
 * API key creation dialog with required expiry selection and one-time secret reveal.
 */
export function CreateApiKeyDialog({ onCreate }: CreateApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<ApiKeyExpiryDays>(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdPrefix, setCreatedPrefix] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const created = await onCreate({
        name,
        expiresInDays,
      });
      setCreatedSecret(created.secret);
      setCreatedPrefix(created.key.keyPrefix);
      setName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create API key");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setCreatedSecret(null);
      setCreatedPrefix(null);
      setError(null);
      setName("");
      setExpiresInDays(30);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>Create API key</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace API key</DialogTitle>
          <DialogDescription>
            Keys are workspace-bound and require an explicit expiry.
          </DialogDescription>
        </DialogHeader>

        {createdSecret ? (
          <Alert>
            <AlertTitle>Copy this secret now</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {createdPrefix} created. This secret is shown once and will not be retrievable
                later.
              </p>
              <code className="bg-muted block overflow-x-auto rounded p-2 text-xs">
                {createdSecret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(createdSecret)}
              >
                Copy secret
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={handleCreate}>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>API key creation failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI token"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key-expiry">Expiry</Label>
              <Select
                value={String(expiresInDays)}
                onValueChange={(value) => setExpiresInDays(Number(value) as ApiKeyExpiryDays)}
              >
                <SelectTrigger id="api-key-expiry">
                  <SelectValue placeholder="Select expiry" />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} days
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

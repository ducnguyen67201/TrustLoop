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
import { ApiKeyOneTimeSecretDisplay } from "@/components/workspace/api-key-secret-display";
import type { ApiKeyExpiryDays, WorkspaceApiKeyCreateResponse } from "@shared/types";
import { useRef, useState } from "react";
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
  // Synchronous guard: setIsSubmitting only updates on the next render, so two
  // rapid Enter/clicks can both pass the disabled check and create duplicate keys.
  const submitInFlight = useRef(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
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
      submitInFlight.current = false;
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

  const isRevealing = createdSecret !== null;
  // Lock all close paths (X button, outside click, Escape) while creating or
  // revealing — both states would lose the one-time secret if the dialog closed.
  const isLocked = isRevealing || isSubmitting;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>Create API key</Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!isLocked}
        onInteractOutside={(event) => {
          if (isLocked) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isLocked) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isRevealing ? "Copy your API key now" : "Create workspace API key"}
          </DialogTitle>
          <DialogDescription>
            {isRevealing
              ? "This is the only time the full secret will be shown. Copy and store it before closing this dialog."
              : "Keys are workspace-bound and require an explicit expiry."}
          </DialogDescription>
        </DialogHeader>

        {createdSecret ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTitle>One-time reveal — save it now</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  Key <code className="font-mono">{createdPrefix}</code> was created. After you
                  close this dialog the full secret cannot be recovered — the API key list only
                  shows the prefix.
                </p>
                <p>
                  Use the <strong>entire</strong> string below (prefix + dot + secret) as your
                  bearer token. The prefix alone will not authenticate.
                </p>
              </AlertDescription>
            </Alert>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <ApiKeyOneTimeSecretDisplay secret={createdSecret} onCopyError={setError} />
            <DialogFooter>
              <Button type="button" onClick={() => handleClose(false)}>
                I&apos;ve saved my key
              </Button>
            </DialogFooter>
          </div>
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

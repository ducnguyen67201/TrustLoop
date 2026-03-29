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
import { useState } from "react";

interface RevokeApiKeyDialogProps {
  keyId: string;
  keyPrefix: string;
  onConfirm: (keyId: string) => Promise<void>;
}

/**
 * Confirmation dialog for revoking a workspace API key.
 */
export function RevokeApiKeyDialog({ keyId, keyPrefix, onConfirm }: RevokeApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setIsSubmitting(true);

    try {
      await onConfirm(keyId);
      setOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke API key</DialogTitle>
          <DialogDescription>
            This will immediately disable <strong>{keyPrefix}</strong> for all future requests.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Revoking..." : "Confirm revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

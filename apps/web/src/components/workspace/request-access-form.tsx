"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceAccessRequest } from "@/hooks/use-workspace-access-request";
import { useState } from "react";
import type { FormEvent } from "react";

/**
 * Request-access form shown when a user has no workspace memberships.
 */
export function RequestAccessForm() {
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");
  const accessRequest = useWorkspaceAccessRequest();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await accessRequest.submitRequest({
      contactEmail: contactEmail || undefined,
      message,
    });
  }

  if (accessRequest.submitted) {
    return (
      <Alert>
        <AlertTitle>Request submitted</AlertTitle>
        <AlertDescription>
          We received your access request. Our team will contact you with next steps.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {accessRequest.error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to submit request</AlertTitle>
          <AlertDescription>{accessRequest.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="contact-email" className="text-xs font-medium text-muted-foreground">
          Contact email
        </Label>
        <Input
          id="contact-email"
          type="email"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          placeholder="you@company.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="access-message" className="text-xs font-medium text-muted-foreground">
          Which workspace do you need?
        </Label>
        <Textarea
          id="access-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Workspace name, owner email, and why you need access"
          rows={3}
          required
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={accessRequest.isSubmitting}>
        {accessRequest.isSubmitting ? "Submitting..." : "Request access"}
      </Button>
    </form>
  );
}

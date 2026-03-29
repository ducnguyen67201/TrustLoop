"use client";

import { trpcMutation } from "@/lib/trpc-http";
import type { WorkspaceRequestAccessRequest, WorkspaceRequestAccessResponse } from "@shared/types";
import { useCallback, useState } from "react";

/**
 * Submits contact-us access requests for users with no workspace memberships.
 */
export function useWorkspaceAccessRequest() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submitRequest = useCallback(async (payload: WorkspaceRequestAccessRequest) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await trpcMutation<WorkspaceRequestAccessRequest, WorkspaceRequestAccessResponse>(
        "workspace.requestAccess",
        payload,
        { withCsrf: true }
      );
      setSubmitted(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to submit request");
      setSubmitted(false);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    isSubmitting,
    error,
    submitted,
    submitRequest,
  };
}

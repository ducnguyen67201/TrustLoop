"use client";

import { useCallback, useState } from "react";

export function AccountStatusPanel() {
  const [message, setMessage] = useState<string | null>(null);

  const loadAccountStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/accounts/status");
      if (!response.ok) {
        setMessage(`Account status failed to load (HTTP ${response.status})`);
        return;
      }
      const data = (await response.json()) as { plan?: string; status?: string };
      setMessage(`Plan: ${data.plan ?? "unknown"} (${data.status ?? "unknown"})`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account status failed to load");
    } finally {
      setTimeout(() => setMessage(null), 3000);
    }
  }, []);

  return (
    <div className="card">
      <h2>Account Status</h2>
      <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
        Load the customer's current plan and renewal details.
      </p>
      <div className="btn-row">
        <button type="button" className="btn-danger" onClick={loadAccountStatus}>
          Load Account Status
        </button>
        {message && <span className="flash">{message}</span>}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

export default function DashboardPage() {
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
      setTimeout(() => setMessage(null), 1500);
    }
  }, []);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="text-muted" style={{ marginBottom: "1rem" }}>
        Review customer account details and billing state.
      </p>

      <div className="card">
        <h2>Dashboard Actions</h2>
        <div className="btn-grid">
          <div className="btn-row">
            <button type="button" className="btn-danger" onClick={loadAccountStatus}>
              Load Account Status
            </button>
            {message && <span className="flash">{message}</span>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Link href="/">&larr; Back to Home</Link>
      </div>
    </>
  );
}

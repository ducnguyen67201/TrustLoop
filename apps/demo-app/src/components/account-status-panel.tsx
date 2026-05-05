"use client";

import { useCallback, useState } from "react";

export function AccountStatusPanel() {
  const [message, setMessage] = useState<string | null>(null);

  const loadAccountStatus = useCallback(() => {
    fetch("/api/account/status").catch(() => {});
    setMessage("Account status failed to load");
    setTimeout(() => setMessage(null), 3000);
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

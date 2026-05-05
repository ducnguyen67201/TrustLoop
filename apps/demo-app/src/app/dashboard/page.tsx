"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

export default function DashboardPage() {
  const [flash, setFlash] = useState(false);

  const loadAccountStatus = useCallback(() => {
    fetch("/api/account/status").catch(() => {});
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
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
            {flash && <span className="flash">Account status failed to load</span>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Link href="/">&larr; Back to Home</Link>
      </div>
    </>
  );
}

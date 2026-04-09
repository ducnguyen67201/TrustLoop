"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

export default function DashboardPage() {
  const [flash, setFlash] = useState(false);

  const fetchData = useCallback(() => {
    fetch("/api/data").catch(() => {});
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
  }, []);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="text-muted" style={{ marginBottom: "1rem" }}>
        This page exists to test route change capture. Navigating here from Home generates a ROUTE event.
      </p>

      <div className="card">
        <h2>Dashboard Actions</h2>
        <div className="btn-grid">
          <div className="btn-row">
            <button className="btn-danger" onClick={fetchData}>
              Load Data (triggers 404)
            </button>
            {flash && <span className="flash">Triggered!</span>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Link href="/">&larr; Back to Home</Link>
      </div>
    </>
  );
}

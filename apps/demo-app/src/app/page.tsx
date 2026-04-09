"use client";

import { ErrorPanel } from "@/components/error-panel";
import { IdentityBar } from "@/components/identity-bar";
import { LoginForm } from "@/components/login-form";
import Link from "next/link";
import { useState } from "react";

interface UserInfo {
  id: string;
  name: string;
  email: string;
}

export default function HomePage() {
  const [user, setUser] = useState<UserInfo | null>(null);

  return (
    <>
      <h1>TrustLoop Demo App</h1>
      <p className="text-muted" style={{ marginBottom: "1rem" }}>
        Simulates a customer app with the @trustloop/sdk installed. Triggers events that flow to the TrustLoop ingest endpoint.
      </p>

      {user ? (
        <IdentityBar
          name={user.name}
          email={user.email}
          userId={user.id}
          onLogout={() => setUser(null)}
        />
      ) : (
        <LoginForm onLogin={setUser} />
      )}

      <ErrorPanel />

      <div className="card">
        <h2>Route Navigation</h2>
        <p className="text-muted" style={{ marginBottom: "0.5rem" }}>
          Navigate to test ROUTE event capture.
        </p>
        <Link href="/dashboard">Go to Dashboard &rarr;</Link>
      </div>
    </>
  );
}

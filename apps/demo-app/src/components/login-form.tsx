"use client";

import { loginUser } from "@/lib/sdk";
import { useState, type FormEvent } from "react";

interface UserInfo {
  id: string;
  name: string;
  email: string;
}

interface LoginFormProps {
  onLogin: (user: UserInfo) => void;
}

export function LoginForm({ onLogin }: LoginFormProps) {
  const [id, setId] = useState("user_123");
  const [name, setName] = useState("Jane Doe");
  const [email, setEmail] = useState("jane@acme.com");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    loginUser(id, email, name);
    onLogin({ id, name, email });
  }

  return (
    <div className="card">
      <h2>Login</h2>
      <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
        Identify the user so session replays can be matched to support conversations.
      </p>
      <form onSubmit={handleSubmit} className="form-grid">
        <div>
          <label htmlFor="userId">User ID</label>
          <input id="userId" value={id} onChange={(e) => setId(e.target.value)} />
        </div>
        <div>
          <label htmlFor="name">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary">
          Login
        </button>
      </form>
    </div>
  );
}

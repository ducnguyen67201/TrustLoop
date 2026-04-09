"use client";

interface IdentityBarProps {
  name: string;
  email: string;
  userId: string;
  onLogout: () => void;
}

export function IdentityBar({ name, email, userId, onLogout }: IdentityBarProps) {
  return (
    <div className="identity-bar">
      <span className="dot" />
      <span>Recording</span>
      <span style={{ margin: "0 0.25rem" }}>|</span>
      <strong>{name}</strong>
      <span>({email})</span>
      <span className="text-muted">{userId}</span>
      <button onClick={onLogout} style={{ marginLeft: "auto", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
        Logout
      </button>
    </div>
  );
}

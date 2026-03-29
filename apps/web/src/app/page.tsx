const checks = [
  "Next.js 16 app boundary",
  "Shared tRPC router via @shared/rest",
  "Shared REST handlers via @shared/rest",
  "Temporal workflow dispatch from API layer",
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 860, margin: "72px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: 8 }}>TrustLoop Foundation Ready</h1>
      <p style={{ color: "var(--muted)", marginBottom: 28 }}>
        Web and worker foundations are scaffolded with shared contracts and workflow dispatch
        boundaries.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {checks.map((check) => (
          <li
            key={check}
            style={{ background: "var(--panel)", borderRadius: 10, padding: "14px 16px" }}
          >
            {check}
          </li>
        ))}
      </ul>
    </main>
  );
}

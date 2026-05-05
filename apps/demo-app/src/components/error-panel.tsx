"use client";

import { useCallback, useState } from "react";

interface ErrorToast {
  id: number;
  type: "exception" | "console" | "network";
  message: string;
}

let toastId = 0;

export function ErrorPanel() {
  const [toasts, setToasts] = useState<ErrorToast[]>([]);

  const addToast = useCallback((type: ErrorToast["type"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  function throwUncaughtError() {
    addToast("exception", "Uncaught Error: Demo exception thrown");
    // Use window.onerror path instead of throw to avoid Next.js dev overlay
    const err = new Error("Demo: uncaught exception from error panel");
    window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
  }

  function triggerConsoleError() {
    console.error("Demo: intentional console error", { code: "E_DEMO", ts: Date.now() });
    addToast("console", "console.error() fired");
  }

  function triggerConsoleWarn() {
    console.warn("Demo: intentional console warning", { code: "W_DEMO", ts: Date.now() });
    addToast("console", "console.warn() fired");
  }

  function fetchUnreachable() {
    fetch("http://localhost:9999/unreachable").catch(() => {});
    addToast("network", "GET localhost:9999 → connection refused");
  }

  return (
    <div className="card">
      <h2>Error Simulation</h2>
      <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
        Each button triggers a different SDK event type. Check the browser console for [TrustLoop]
        debug logs.
      </p>
      <div className="btn-grid">
        <div className="btn-row">
          <button type="button" className="btn-danger" onClick={throwUncaughtError}>
            Throw Uncaught Error
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn-danger" onClick={triggerConsoleError}>
            Console Error
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn-warning" onClick={triggerConsoleWarn}>
            Console Warning
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn-danger" onClick={fetchUnreachable}>
            Fetch Unreachable Host
          </button>
        </div>
      </div>

      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              {toast.type === "exception" && "💥 "}
              {toast.type === "console" && "⚠ "}
              {toast.type === "network" && "🔌 "}
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

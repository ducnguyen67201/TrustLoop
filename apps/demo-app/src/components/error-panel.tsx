"use client";

import { useCallback, useState } from "react";

export function ErrorPanel() {
  const [flash, setFlash] = useState<string | null>(null);

  const showFlash = useCallback((label: string) => {
    setFlash(label);
    setTimeout(() => setFlash(null), 1500);
  }, []);

  function throwUncaughtError() {
    showFlash("exception");
    setTimeout(() => {
      throw new Error("Demo: uncaught exception from error panel");
    }, 0);
  }

  function triggerConsoleError() {
    console.error("Demo: intentional console error", { code: "E_DEMO", ts: Date.now() });
    showFlash("console.error");
  }

  function triggerConsoleWarn() {
    console.warn("Demo: intentional console warning", { code: "W_DEMO", ts: Date.now() });
    showFlash("console.warn");
  }

  function fetchNotFound() {
    fetch("/api/does-not-exist").catch(() => {});
    showFlash("fetch 404");
  }

  function fetchUnreachable() {
    fetch("http://localhost:9999/unreachable").catch(() => {});
    showFlash("fetch unreachable");
  }

  return (
    <div className="card">
      <h2>Error Simulation</h2>
      <p className="text-muted" style={{ marginBottom: "0.75rem" }}>
        Each button triggers a different SDK event type. Check the browser console for [TrustLoop] debug logs.
      </p>
      <div className="btn-grid">
        <div className="btn-row">
          <button className="btn-danger" onClick={throwUncaughtError}>
            Throw Uncaught Error
          </button>
          {flash === "exception" && <span className="flash">Triggered!</span>}
        </div>
        <div className="btn-row">
          <button className="btn-danger" onClick={triggerConsoleError}>
            Console Error
          </button>
          {flash === "console.error" && <span className="flash">Triggered!</span>}
        </div>
        <div className="btn-row">
          <button className="btn-warning" onClick={triggerConsoleWarn}>
            Console Warning
          </button>
          {flash === "console.warn" && <span className="flash">Triggered!</span>}
        </div>
        <div className="btn-row">
          <button className="btn-danger" onClick={fetchNotFound}>
            Fetch 404
          </button>
          {flash === "fetch 404" && <span className="flash">Triggered!</span>}
        </div>
        <div className="btn-row">
          <button className="btn-danger" onClick={fetchUnreachable}>
            Fetch Unreachable Host
          </button>
          {flash === "fetch unreachable" && <span className="flash">Triggered!</span>}
        </div>
      </div>
    </div>
  );
}

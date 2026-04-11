"use client";

import { useEffect, useRef, useState } from "react";

function CodeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      role="img"
      aria-label="Code icon"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

export function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="w-full max-w-6xl relative mx-auto"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(1.5rem)",
        transition: "opacity 1s ease-out, transform 1s ease-out",
      }}
    >
      <div className="text-[10px] uppercase tracking-widest text-[#8B7E74] mb-4">
        Message to Resolution
      </div>
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-0 relative">
        {/* Stage 1: Slack Message */}
        <div className="w-full md:w-[30%] bg-white border border-[#EAE5E0] p-5 flex flex-col gap-3 relative z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <img
              src="https://i.pravatar.cc/80?img=47"
              alt="sarah.chen"
              className="w-8 h-8 rounded-full object-cover shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-[#1C1917]">sarah.chen</span>
              <span className="text-[10px] text-[#8B7E74]">2:34 PM</span>
            </div>
          </div>
          <p className="text-xs text-[#1C1917] leading-relaxed">
            Hey, the /api/webhooks endpoint is returning 502s again. Started about 20 min ago.
            Customers are noticing.
          </p>
        </div>

        {/* Connector 1 — Desktop */}
        <div className="hidden md:flex grow h-[1px] bg-[#D4A017] relative z-0 mx-2" />
        {/* Connector 1 — Mobile */}
        <div className="flex md:hidden h-8 w-[1px] bg-[#D4A017] relative z-0 mx-auto my-2" />

        {/* Stage 2: TrustLoop Core */}
        <div className="w-full md:w-[30%] flex flex-col items-center gap-4 relative z-10">
          <div className="w-12 h-12 border border-[#1C1917] bg-white flex items-center justify-center relative z-10">
            <CodeIcon />
          </div>
          <div className="w-full h-32 bg-[#1C1917] p-4 text-[#F4F1EE] text-[10px] overflow-hidden flex flex-col justify-end relative">
            <div className="absolute top-0 left-0 w-full h-4 bg-gradient-to-b from-[#1C1917] to-transparent z-10" />
            <div className="flex flex-col gap-1.5 w-full">
              <span>&gt; grouping thread...</span>
              <span>&gt; loading repo context...</span>
              <span>&gt; analyzing webhook handler...</span>
              <span>&gt; found: src/server/webhooks.ts:47</span>
              <span>&gt; drafting response...</span>
            </div>
          </div>
        </div>

        {/* Connector 2 — Desktop */}
        <div className="hidden md:flex grow h-[1px] bg-[#D4A017] relative z-0 mx-2" />
        {/* Connector 2 — Mobile */}
        <div className="flex md:hidden h-8 w-[1px] bg-[#D4A017] relative z-0 mx-auto my-2" />

        {/* Stage 3: Draft — Sent */}
        <div
          className="w-full md:w-[32%] bg-white border border-[#EAE5E0] p-5 flex flex-col gap-3 relative z-10 shadow-sm overflow-hidden"
          style={{ borderLeftWidth: "3px", borderLeftColor: "#8B7E74" }}
        >
          <div className="text-[10px] uppercase tracking-widest text-[#8B7E74] flex items-center justify-between">
            <span>AI Draft</span>
            <span className="text-[#8B7E74]">Sent</span>
          </div>
          <p className="text-xs text-[#1C1917] leading-relaxed">
            Found the issue — the webhook handler at webhooks.ts:47 is timing out on payload
            validation when the request body exceeds 1MB. Pushing a fix now with streaming
            validation. ETA: 30 min.
          </p>
          <button
            type="button"
            className="mt-2 w-full py-2.5 text-xs font-semibold flex items-center justify-center bg-[#D4A017] border border-[#D4A017] text-[#1C1917]"
          >
            &#10003; Sent to Slack
          </button>
        </div>
      </div>
    </div>
  );
}

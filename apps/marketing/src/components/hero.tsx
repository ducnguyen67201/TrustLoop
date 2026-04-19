"use client";

import { useEffect, useState } from "react";

const HEADLINE = "Slack support that reads your code. Then drafts the fix.";

export function Hero() {
  const [text, setText] = useState("");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(HEADLINE);
      return;
    }

    let cancelled = false;
    let i = 0;

    function type() {
      if (cancelled || i > HEADLINE.length) return;
      setText(HEADLINE.slice(0, i));
      i++;
      setTimeout(type, 50 + Math.random() * 30);
    }

    const timer = setTimeout(type, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="max-w-4xl z-10 relative text-center mx-auto">
      {/* Tag pill — frosted glass, pulsing accent dot */}
      <div className="relative inline-flex items-center gap-2.5 rounded-full px-5 py-2.5 mb-10 bg-white/70 backdrop-blur-md border border-white ring-1 ring-[#EAE5E0] shadow-[0_4px_32px_rgba(232,89,37,0.12)]">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#E85925] opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E85925]" />
        </span>
        <span className="text-[11px] uppercase tracking-widest text-[#1C1917] font-semibold">
          Now in Early Access
        </span>
      </div>

      <h1 className="text-5xl md:text-7xl lg:text-8xl font-semibold tracking-tight text-[#1C1917] mb-8 leading-[1.05]">
        <span>{text}</span>
        <span className="cursor-blink text-[#D4A017] font-normal">|</span>
      </h1>
      <p className="text-lg md:text-xl text-[#8B7E74] mb-12 max-w-2xl mx-auto leading-relaxed">
        Built for engineering teams drowning in customer support threads. Reads your repo, replays
        the customer&apos;s session, drafts the Slack reply, and preps the fix PR. Your engineer
        approves. No hallucinations, every answer grounded in real code.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 mb-24 justify-center">
        <a
          href="https://calendar.app.google/RPU52joHKB57nrrL7"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-[#D4A017] text-[#1C1917] px-8 py-4 font-semibold text-sm hover:bg-[#E5B532] transition-colors inline-flex justify-center items-center"
        >
          Book a Call
        </a>
        <a
          href="#how-it-works"
          className="border border-[#1C1917] text-[#1C1917] bg-transparent px-8 py-4 font-semibold text-sm hover:bg-[#1C1917] hover:text-[#F4F1EE] transition-colors inline-flex justify-center items-center"
        >
          See How It Works
        </a>
      </div>
    </div>
  );
}

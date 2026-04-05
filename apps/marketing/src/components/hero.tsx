"use client";

import { useEffect, useState } from "react";

const HEADLINE = "Support that knows your codebase.";

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
      {/* Tag pill */}
      <div className="inline-flex items-center gap-2 border border-[#EAE5E0] rounded-full px-5 py-2 mb-10 bg-white/60 backdrop-blur-sm">
        <span className="w-2 h-2 rounded-full bg-[#D4A017]" />
        <span className="text-[11px] uppercase tracking-widest text-[#8B7E74]">
          Now in Early Access
        </span>
      </div>

      <h1 className="text-5xl md:text-7xl lg:text-8xl font-semibold tracking-tight text-[#1C1917] mb-8 leading-[1.05]">
        <span>{text}</span>
        <span className="cursor-blink text-[#D4A017] font-normal">|</span>
      </h1>
      <p className="text-lg md:text-xl text-[#8B7E74] mb-12 max-w-2xl mx-auto leading-relaxed">
        Chat messages become tickets. AI drafts responses using your actual
        code. Engineers review and send. Hours saved, every week.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 mb-24 justify-center">
        <a
          href="#cta"
          className="bg-[#D4A017] text-[#1C1917] px-8 py-4 font-semibold text-sm hover:bg-[#E5B532] transition-colors inline-flex justify-center items-center"
        >
          Get Early Access
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

"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  { num: 1, text: "Connect Slack and GitHub in two clicks." },
  {
    num: 2,
    text: "TrustLoop indexes your repos and groups incoming support threads automatically.",
  },
  {
    num: 3,
    text: "AI analyzes each thread with relevant code context and drafts a response.",
  },
  {
    num: 4,
    text: "Your engineer reviews the draft, edits if needed, approves. Sent back to Slack.",
  },
];

function AnimatedNumber({ target }: { target: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);
  const [active, setActive] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !triggered.current) {
          triggered.current = true;

          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setValue(target);
            setActive(true);
            return;
          }

          let start: number | null = null;
          function step(ts: number) {
            if (!start) start = ts;
            const progress = Math.min((ts - start) / 1500, 1);
            setValue(Math.floor(progress * target));
            if (progress > 0.5) setActive(true);
            if (progress < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -50px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  const display = value < 10 ? `0${value}` : `${value}`;

  return (
    <div
      ref={ref}
      className={`text-4xl md:text-5xl font-semibold tracking-tight w-16 shrink-0 transition-colors duration-1000 group-hover:text-[#D4A017] ${
        active ? "text-[#D4A017]" : "text-[#EAE5E0]"
      }`}
    >
      {display}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="w-full py-32 border-t border-[#EAE5E0] bg-section-warm">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <p className="text-xs uppercase tracking-widest text-[#8B7E74] mb-20">How It Works</p>
        <div className="max-w-4xl flex flex-col gap-16 md:gap-24">
          {STEPS.map((step) => (
            <div
              key={step.num}
              className="flex flex-col md:flex-row gap-6 md:gap-12 items-start group"
            >
              <AnimatedNumber target={step.num} />
              <div className="text-xl md:text-3xl text-[#1C1917] leading-snug">{step.text}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

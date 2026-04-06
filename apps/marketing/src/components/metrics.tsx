"use client";

import { useEffect, useRef, useState } from "react";

function AnimatedMetric({ target }: { target: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
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
            return;
          }

          let start: number | null = null;
          function step(ts: number) {
            if (!start) start = ts;
            const progress = Math.min((ts - start) / 2000, 1);
            setValue(Math.floor(progress * target));
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

  return <span ref={ref}>{value}</span>;
}

export function Metrics() {
  return (
    <section className="w-full py-32 border-t border-[#EAE5E0] bg-fade-top">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <div className="max-w-4xl">
          <p className="text-2xl md:text-3xl font-medium text-[#1C1917] mb-4 leading-tight tracking-tight">
            Currently onboarding early design partners.
          </p>
          <p className="text-lg text-[#8B7E74] mb-20">
            Built by engineers who lived the on-call support nightmare.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-12 pt-12 border-t border-[#EAE5E0]">
            <div>
              <div className="text-4xl md:text-5xl font-semibold tracking-tight text-[#D4A017] mb-4 flex items-center">
                <span className="text-3xl mr-1">&lt;</span>
                <AnimatedMetric target={30} />
                <span>s</span>
              </div>
              <div className="text-xs uppercase tracking-widest text-[#1C1917]">
                To first AI draft
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-semibold tracking-tight text-[#D4A017] mb-4 flex items-center">
                <AnimatedMetric target={90} />
                <span>%+</span>
              </div>
              <div className="text-xs uppercase tracking-widest text-[#1C1917]">
                Code context accuracy
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-semibold tracking-tight text-[#D4A017] mb-4">
                Hours
              </div>
              <div className="text-xs uppercase tracking-widest text-[#1C1917]">
                Saved per eng / week
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

const ITEMS = [
  {
    title: "Human-in-the-loop always",
    desc: "No AI response reaches your customer without engineer approval. You hold the final key.",
  },
  {
    title: "Your code stays yours",
    desc: "Embeddings are strictly scoped to your workspace. No cross-tenant data sharing or model training.",
  },
  {
    title: "Built for SOC 2",
    desc: "Audit logging, encrypted sessions, and role-based access control implemented from day one.",
  },
];

const PADDING = ["md:pr-8 lg:pr-12", "md:px-8 lg:px-12", "md:pl-8 lg:pl-12"];

function TrustItem({
  title,
  desc,
  delay,
}: {
  title: string;
  desc: string;
  delay: number;
}) {
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
          setTimeout(() => setVisible(true), delay);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -50px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className="py-12 md:py-8"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(1.5rem)",
        transition: "opacity 0.8s ease-out, transform 0.8s ease-out",
      }}
    >
      <h3 className="text-lg font-semibold text-[#1C1917] mb-4 tracking-tight">
        {title}
      </h3>
      <p className="text-sm text-[#8B7E74] leading-relaxed">{desc}</p>
    </div>
  );
}

export function TrustSection() {
  return (
    <section className="w-full py-32 border-t border-[#EAE5E0] bg-section-warm bg-fade-top">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
      <p className="text-xs uppercase tracking-widest text-[#8B7E74] mb-20">
        Trust By Default
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EAE5E0] border-y border-[#EAE5E0]">
        {ITEMS.map((item, i) => (
          <div key={item.title} className={PADDING[i]}>
            <TrustItem title={item.title} desc={item.desc} delay={i * 200} />
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

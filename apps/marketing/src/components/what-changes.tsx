const BENEFITS = [
  {
    title: "Mean response time drops",
    desc: "AI drafts appear in seconds, not hours. Faster resolutions without keeping a human glued to the queue.",
  },
  {
    title: "Support quality goes up",
    desc: "Every response grounded in your actual codebase, not guesswork or outdated knowledge base articles.",
  },
  {
    title: "Engineers stay in flow",
    desc: "Review and approve from Slack. No context-switching to a clunky third-party support tool.",
  },
];

function BenefitItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="py-12">
      <h3 className="text-xl font-semibold text-[#1C1917] mb-4 tracking-tight">{title}</h3>
      <p className="text-base text-[#8B7E74] leading-relaxed">{desc}</p>
    </div>
  );
}

export function WhatChanges() {
  return (
    <section id="features" className="w-full py-32 border-t border-[#EAE5E0]">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <p className="text-xs uppercase tracking-widest text-[#8B7E74] mb-12 md:mb-20">
          What Changes
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EAE5E0] border-y border-[#EAE5E0]">
          {BENEFITS.map((benefit, i) => (
            <div
              key={benefit.title}
              className={
                i === 0 ? "md:pr-8 lg:pr-12" : i === 1 ? "md:px-8 lg:px-12" : "md:pl-8 lg:pl-12"
              }
            >
              <BenefitItem title={benefit.title} desc={benefit.desc} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const BENEFITS = [
  {
    title: "Mean response time drops",
    desc: "AI drafts appear in seconds, not hours. Provide faster resolutions without keeping a human glued to the queue.",
  },
  {
    title: "Support quality goes up",
    desc: "Every response grounded in your actual codebase, not guesswork or outdated knowledge base articles.",
  },
  {
    title: "Engineers stay in flow",
    desc: "Review and approve from Slack. No context-switching to a clunky third-party support tool.",
  },
  {
    title: "Everything is measurable",
    desc: "Draft acceptance rate, time saved, resolution speed. Real numbers for your ops team.",
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
    <section className="w-full py-32 border-t border-[#EAE5E0]">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <p className="text-xs uppercase tracking-widest text-[#8B7E74] mb-12 md:mb-20">
          What Changes
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 lg:gap-x-24">
          <div className="flex flex-col border-t border-[#EAE5E0] md:border-t-0">
            <div className="border-b border-[#EAE5E0] md:border-t">
              <BenefitItem title={BENEFITS[0]!.title} desc={BENEFITS[0]!.desc} />
            </div>
            <div className="border-b md:border-b-0 border-[#EAE5E0]">
              <BenefitItem title={BENEFITS[1]!.title} desc={BENEFITS[1]!.desc} />
            </div>
          </div>
          <div className="flex flex-col">
            <div className="border-b border-[#EAE5E0] md:border-t">
              <BenefitItem title={BENEFITS[2]!.title} desc={BENEFITS[2]!.desc} />
            </div>
            <div className="border-b md:border-b-0 border-[#EAE5E0]">
              <BenefitItem title={BENEFITS[3]!.title} desc={BENEFITS[3]!.desc} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

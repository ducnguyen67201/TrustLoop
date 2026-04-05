"use client";

export function CtaSection() {
  return (
    <section
      id="cta"
      className="w-full py-32 bg-[#1C1917] text-[#F4F1EE]"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-8">
      <div className="max-w-3xl">
        <h2 className="text-4xl md:text-5xl font-semibold tracking-tight mb-8 leading-tight">
          Your support queue won&apos;t fix itself.
        </h2>
        <p className="text-lg text-[#8B7E74] mb-12 leading-relaxed max-w-xl">
          Limited early access spots. Engineering teams with Slack + GitHub get
          priority.
        </p>

        <form
          className="flex flex-col sm:flex-row gap-0 max-w-xl"
          onSubmit={(e) => e.preventDefault()}
        >
          <input
            type="email"
            placeholder="Email address"
            required
            className="bg-transparent border border-[#8B7E74] text-[#F4F1EE] px-6 py-4 grow outline-none focus:border-[#D4A017] text-sm placeholder:text-[#8B7E74] transition-colors w-full"
          />
          <div className="cta-pulse-wrapper mt-4 sm:mt-0 w-full sm:w-auto">
            <button
              type="submit"
              className="bg-[#D4A017] text-[#1C1917] font-semibold px-8 py-4 hover:bg-[#E5B532] transition-colors whitespace-nowrap text-sm w-full relative z-10"
            >
              Request Access
            </button>
          </div>
        </form>
      </div>
      </div>
    </section>
  );
}

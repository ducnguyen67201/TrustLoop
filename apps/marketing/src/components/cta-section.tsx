const BOOKING_URL = "https://calendar.app.google/RPU52joHKB57nrrL7";

export function CtaSection() {
  return (
    <section id="cta" className="w-full py-32 bg-[#1C1917] text-[#F4F1EE]">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <div className="max-w-3xl">
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight mb-8 leading-tight">
            Your support queue won&apos;t fix itself.
          </h2>
          <p className="text-lg text-[#8B7E74] mb-12 leading-relaxed max-w-xl">
            Limited early access spots. Engineering teams with Slack + GitHub get priority. Book a
            15-minute intro call and we&apos;ll walk you through a live demo.
          </p>

          <div className="cta-pulse-wrapper inline-block w-full sm:w-auto">
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-10 inline-flex items-center justify-center bg-[#D4A017] text-[#1C1917] font-semibold px-8 py-4 hover:bg-[#E5B532] transition-colors whitespace-nowrap text-sm w-full sm:w-auto"
            >
              Book an Intro Call →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

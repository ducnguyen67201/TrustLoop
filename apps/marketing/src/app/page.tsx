import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { Pipeline } from "@/components/pipeline";
import { HowItWorks } from "@/components/how-it-works";
import { WhatChanges } from "@/components/what-changes";
import { TrustSection } from "@/components/trust-section";
import { Metrics } from "@/components/metrics";
import { CtaSection } from "@/components/cta-section";
import { Footer } from "@/components/footer";

export default function Page() {
  return (
    <>
      <Nav />
      <header className="w-full min-h-screen flex flex-col justify-center pt-32 pb-16 bg-hero-glow">
        <div className="max-w-6xl mx-auto px-6 md:px-8 w-full">
          <Hero />
          <Pipeline />
        </div>
      </header>
      <HowItWorks />
      <WhatChanges />
      <TrustSection />
      <Metrics />
      <CtaSection />
      <Footer />
    </>
  );
}

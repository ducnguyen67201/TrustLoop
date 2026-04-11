import { CtaSection } from "@/components/cta-section";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Nav } from "@/components/nav";
import { Origin } from "@/components/origin";
import { Pipeline } from "@/components/pipeline";
import { Team } from "@/components/team";
import { TrustSection } from "@/components/trust-section";
import { WhatChanges } from "@/components/what-changes";

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
      <Origin />
      <Team />
      <CtaSection />
      <Footer />
    </>
  );
}

import photo1 from "@shared/brand/hackathon/photo-1.jpg";
import photo2 from "@shared/brand/hackathon/photo-2.jpg";
import photo3 from "@shared/brand/hackathon/photo-3.jpg";
import Image from "next/image";

const GALLERY = [
  { src: photo1, alt: "LotusHacks — TrustLoop AI team on stage" },
  { src: photo2, alt: "LotusHacks — demo and judges" },
  { src: photo3, alt: "LotusHacks — award presentation" },
];

const AWARDS = [
  {
    label: "Top 5 Overall",
    detail: "Finalist",
  },
  {
    label: "#1 Best Use of Codex",
    detail: "OpenAI category",
  },
  {
    label: "#1 Best Use of OpenRouter",
    detail: "OpenRouter category",
  },
];

export function Origin() {
  return (
    <section className="w-full py-32 border-t border-[#EAE5E0]">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <p className="text-xs uppercase tracking-widest text-[#8B7E74] mb-12 md:mb-20">
          How It Started
        </p>

        <div className="max-w-3xl mb-16 md:mb-20">
          <h2 className="text-2xl md:text-3xl font-medium text-[#1C1917] leading-tight tracking-tight mb-8">
            Built at LotusHacks.
            <br />
            Then engineers kept asking when they could use it.
          </h2>
          <p className="text-base md:text-lg text-[#8B7E74] leading-relaxed">
            We prototyped TrustLoop AI at Vietnam&apos;s largest hackathon, sponsored by OpenAI. The
            agent read real codebases and drafted real support responses on stage. Judges liked it.
            The engineers in the audience liked it more. We kept building.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-16 md:mb-20">
          {GALLERY.map((photo) => (
            <div
              key={photo.alt}
              className="relative aspect-[4/3] overflow-hidden bg-[#EAE5E0] border border-[#EAE5E0]"
            >
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes="(min-width: 768px) 33vw, 100vw"
                className="object-cover"
                placeholder="blur"
              />
            </div>
          ))}
        </div>

        <div className="max-w-3xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 pt-12 border-t border-[#EAE5E0]">
            {AWARDS.map((award) => (
              <div key={award.label}>
                <div className="text-[#E85925] text-xs uppercase tracking-widest font-semibold mb-2">
                  {award.label}
                </div>
                <div className="text-sm text-[#8B7E74]">{award.detail}</div>
              </div>
            ))}
          </div>

          <a
            href="https://www.lotushack.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-12 inline-block text-xs uppercase tracking-widest text-[#1C1917] hover:text-[#E85925] transition-colors border-b border-[#1C1917] hover:border-[#E85925] pb-0.5"
          >
            LotusHacks →
          </a>
        </div>
      </div>
    </section>
  );
}

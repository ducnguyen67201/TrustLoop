"use client";

import ducPhoto from "@shared/brand/team/duc.jpg";
import nhatAnhPhoto from "@shared/brand/team/nhat-anh.jpg";
import type { StaticImageData } from "next/image";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type TeamMember = {
  initials: string;
  name: string;
  role: string;
  bio: string;
  link: { label: string; href: string };
  photo?: StaticImageData;
};

// Edit this array to update the team section on the marketing page.
const TEAM: TeamMember[] = [
  {
    initials: "DN",
    name: "Duc Nguyen",
    role: "Founder & Engineering",
    bio: "Ex software engineer at a YC-backed startup. Knows what shipping fast actually costs, and watched the support queue quietly eat engineering velocity. Building TrustLoop AI to stop that.",
    link: { label: "LinkedIn", href: "https://www.linkedin.com/in/ducnguyen6721/" },
    photo: ducPhoto,
  },
  {
    initials: "NA",
    name: "Nhat Anh Tran",
    role: "Co-founder & Engineering",
    bio: "Full-stack engineer obsessed with the craft of shipping tools engineers actually want to use. Building the retrieval and agent pipeline that makes every TrustLoop AI draft grounded in real code.",
    link: { label: "LinkedIn", href: "https://www.linkedin.com/in/nhatanhpgm/" },
    photo: nhatAnhPhoto,
  },
];

const PADDING = ["md:pr-8 lg:pr-12", "md:pl-8 lg:pl-12"];

function TeamCard({
  initials,
  name,
  role,
  bio,
  link,
  photo,
  delay,
}: TeamMember & { delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }

    // If the element is already in view on mount (e.g. back navigation with
    // restored scroll position, or bfcache restore), skip the reveal gate.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
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
      { threshold: 0.2, rootMargin: "0px 0px -50px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className="flex h-full flex-col py-12 md:py-8"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(1.5rem)",
        transition: "opacity 0.8s ease-out, transform 0.8s ease-out",
      }}
    >
      {photo ? (
        <div className="mb-6 relative size-28 overflow-hidden rounded-full border border-[#E85925]">
          <Image
            src={photo}
            alt={name}
            fill
            sizes="112px"
            className="object-cover object-[center_65%]"
            placeholder="blur"
          />
        </div>
      ) : (
        <div className="mb-6 flex size-28 items-center justify-center rounded-full border border-[#E85925] bg-[#1C1917] text-base font-semibold tracking-widest text-[#E85925]">
          {initials}
        </div>
      )}
      <h3 className="text-lg font-semibold text-[#1C1917] mb-1 tracking-tight">{name}</h3>
      <p className="text-[10px] uppercase tracking-widest text-[#E85925] mb-4">{role}</p>
      <p className="text-sm text-[#8B7E74] leading-relaxed mb-6">{bio}</p>
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto self-start text-xs uppercase tracking-widest text-[#1C1917] hover:text-[#E85925] transition-colors border-b border-[#1C1917] hover:border-[#E85925] pb-0.5"
      >
        {link.label}
      </a>
    </div>
  );
}

export function Team() {
  return (
    <section id="team" className="w-full py-32 border-t border-[#EAE5E0]">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <p className="text-xs uppercase tracking-widest text-[#8B7E74] mb-12 md:mb-20">The Team</p>

        <div className="max-w-3xl mb-16 md:mb-20">
          <h2 className="text-2xl md:text-3xl font-medium text-[#1C1917] leading-tight tracking-tight mb-4">
            Built by engineers who lived the on-call
            <br />
            support nightmare.
          </h2>
          <p className="text-base md:text-lg text-[#8B7E74] leading-relaxed">
            Small team, opinionated product. We ship fast because every feature comes from a real
            2am Slack ping.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 md:items-stretch divide-y md:divide-y-0 md:divide-x divide-[#EAE5E0] border-y border-[#EAE5E0]">
          {TEAM.map((member, i) => (
            <div key={member.name} className={`h-full ${PADDING[i]}`}>
              <TeamCard {...member} delay={i * 200} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

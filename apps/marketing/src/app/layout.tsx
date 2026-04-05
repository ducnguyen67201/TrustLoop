import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "TrustLoop | Support Ops for Engineering Teams",
  description:
    "TrustLoop reads your codebase, groups chat threads, and drafts technically accurate support responses.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${mono.className} antialiased min-h-screen flex flex-col bg-[#F4F1EE] text-[#1C1917] overflow-x-hidden bg-dot-grid`}
      >
        {children}
      </body>
    </html>
  );
}
